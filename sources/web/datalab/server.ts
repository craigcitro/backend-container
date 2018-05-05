/*
 * Copyright 2015 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

/// <reference path="../../../third_party/externs/ts/node/node.d.ts" />
/// <reference path="../../../third_party/externs/ts/request/request.d.ts" />
/// <reference path="common.d.ts" />

import fs = require('fs');
import http = require('http');
import jupyter = require('./jupyter');
import logging = require('./logging');
import net = require('net');
import path = require('path');
import request = require('request');
import reverseProxy = require('./reverseProxy');
import settings_ = require('./settings');
import sockets = require('./sockets');
import static_ = require('./static');
import url = require('url');
import wsHttpProxy = require('./wsHttpProxy');
import childProcess = require('child_process');

var server: http.Server;
var staticHandler: http.RequestHandler;

/**
 * The application settings instance.
 */
var appSettings: common.AppSettings;
var loadedSettings: common.UserSettings = null;

/**
 * If it is the user's first request since the web server restarts,
 * need to start jupyter server for that user.
 * We don't track results here. Later requests will go through initialization
 * checks again, and if it is still initializing, those requests will be parked
 * and wait for initialization to complete or fail.
 */
function startInitializationForUser(request: http.ServerRequest): void {
  if (jupyter.getPort(request) == 0) {
    var userId = 'anonymous';
    // Giving null callback so this is fire-and-forget.
    jupyter.startForUser(userId, null);
  }
}

/**
 * Check if workspace and jupyter server is initialized for the user.
 * If not, wait for initialization to be done and then proceed to pass
 * the request to jupyter server.
 */
function handleJupyterRequest(request: http.ServerRequest, response: http.ServerResponse): void {
  var userId = 'anonymous';

  if (jupyter.getPort(request) == 0) {
    // Jupyter server is not created yet. Creating it for user and call self again.
    // Another 'startForUser' may already be ongoing so this 'syncNow' will probably
    // be parked until the ongoing one is done.
    jupyter.startForUser(userId, function(e) {
      if (e) {
        response.statusCode = 500;
        response.end();
      }
      else {
        handleJupyterRequest(request, response);
      }
    });
    return;
  }
  jupyter.handleRequest(request, response);
}

/**
 * Handles all requests.
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 * @path the parsed path in the request.
 */
function handleRequest(request: http.ServerRequest,
                       response: http.ServerResponse,
                       requestPath: string) {

  var userId = 'anonymous';
  if (loadedSettings === null) {
    loadedSettings = settings_.loadUserSettings(userId);
  }

  // If Jupyter is not initialized, do it as early as possible after authentication.
  startInitializationForUser(request);

  if (requestPath.indexOf('/api/basepath') === 0) {
    response.statusCode = 200;
    response.end(appSettings.datalabBasePath);
    return;
  }
  
  // Requests proxied to Jupyter
  if ((requestPath == '/') ||
      (requestPath.indexOf('/api') == 0) ||
      (requestPath.indexOf('/tree') == 0) ||
      (requestPath.indexOf('/notebooks') == 0) ||
      (requestPath.indexOf('/nbconvert') == 0) ||
      (requestPath.indexOf('/nbextensions') == 0) ||
      (requestPath.indexOf('/files') == 0) ||
      (requestPath.indexOf('/edit') == 0) ||
      (requestPath.indexOf('/terminals') == 0) ||
      (requestPath.indexOf('/sessions') == 0)) {

    handleJupyterRequest(request, response);
    return;
  }

  // Not Found
  response.statusCode = 404;
  response.end();
}

/**
 * Base logic for handling all requests sent to the proxy web server. Some
 * requests are handled within the server, while some are proxied to the
 * Jupyter notebook server.
 *
 * Error handling is left to the caller.
 *
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 */
function uncheckedRequestHandler(request: http.ServerRequest, response: http.ServerResponse) {
  var parsed_url = url.parse(request.url, true);
  var urlpath = parsed_url.pathname;

  logging.logRequest(request, response);

  var reverseProxyPort: string = reverseProxy.getRequestPort(request, urlpath);
    
  if (reverseProxyPort) {
    reverseProxy.handleRequest(request, response, reverseProxyPort);
  } else if (urlpath.indexOf('/static') == 0) {
    staticHandler(request, response);
  } else {
    handleRequest(request, response, urlpath);
  }
}

// The path that is used for the optional websocket proxy for HTTP requests.
const httpOverWebSocketPath: string = '/http_over_websocket';

function socketHandler(request: http.ServerRequest, socket: net.Socket, head: Buffer) {
  request.url = trimBasePath(request.url);
  // Avoid proxying websocket requests on this path, as it's handled locally rather than by Jupyter.
  if (request.url != httpOverWebSocketPath) {
    jupyter.handleSocket(request, socket, head);
  }
}

function trimBasePath(requestPath: string): string {
  let pathPrefix = appSettings.datalabBasePath;
  if (requestPath.indexOf(pathPrefix) == 0) {
    let newPath = "/" + requestPath.substring(pathPrefix.length);
    return newPath;
  } else {
    return requestPath;
  }
}

/**
 * Handles all requests sent to the proxy web server. Some requests are handled within
 * the server, while some are proxied to the Jupyter notebook server.
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 */
function requestHandler(request: http.ServerRequest, response: http.ServerResponse) {
  request.url = trimBasePath(request.url);
  try {
    uncheckedRequestHandler(request, response);
  } catch (e) {
    logging.getLogger().error('Uncaught error handling a request to "%s": %s', request.url, e);
  }
}

/**
 * Runs the proxy web server.
 * @param settings the configuration settings to use.
 */
export function run(settings: common.AppSettings): void {
  appSettings = settings;
  jupyter.init(settings);
  reverseProxy.init(settings);
  sockets.init(settings);

  staticHandler = static_.createHandler(settings);

  server = http.createServer(requestHandler);
  server.on('upgrade', socketHandler);

  if (settings.allowHttpOverWebsocket) {
    new wsHttpProxy.WsHttpProxy(server, httpOverWebSocketPath, settings.allowOriginOverrides);
  }

  logging.getLogger().info('Starting DataLab server at http://localhost:%d%s',
                           settings.serverPort,
                           settings.datalabBasePath);
  process.on('SIGINT', () => process.exit());

  server.listen(settings.serverPort);
}

/**
 * Stops the server and associated Jupyter server.
 */
export function stop(): void {
  jupyter.close();
}

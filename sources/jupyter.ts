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

/// <reference path="./externs/node-http-proxy.d.ts" />
/// <reference path="./externs/tcp-port-used.d.ts" />
/// <reference path="common.d.ts" />

import callbacks = require('./callbacks');
import childProcess = require('child_process');
import fs = require('fs');
import http = require('http');
import httpProxy = require('http-proxy');
import logging = require('./logging');
import net = require('net');
import path = require('path');
import settings = require('./settings');
import tcp = require('tcp-port-used');
import util = require('./util');

interface JupyterServer {
  port: number;
  notebooks: string;
  childProcess?: childProcess.ChildProcess;
  proxy?: httpProxy.ProxyServer;
}

/**
 * Jupyter servers key'd by user id (each server is associated with a single user)
 */
var jupyterServer: JupyterServer = null;

/**
 * Used to make sure no multiple initialization runs happen for the same user
 * at same time.
 */
var callbackManager: callbacks.CallbackManager = new callbacks.CallbackManager();

/**
 * The application settings instance.
 */
var appSettings: common.AppSettings;

function pipeOutput(stream: NodeJS.ReadableStream, port: number, error: boolean) {
  stream.setEncoding('utf8');

  stream.on('data', (data: string) => {
    // Jupyter generates a polling kernel message once every 3 seconds
    // per kernel! This adds too much noise into the log, so avoid
    // logging it.

    if (data.indexOf('Polling kernel') < 0) {
      logging.logJupyterOutput('[' + port + ']: ' + data, error);
    }
  })
}

function createJupyterServerAtPort(port: number, userDir: string) {
  var server: JupyterServer = {
    port: port,
    notebooks: userDir,
  };

  function exitHandler(code: number, signal: string): void {
    logging.getLogger().error('Jupyter process %d exited due to signal: %s',
                              server.childProcess.pid, signal);
    jupyterServer = null;
  }

  var secretPath = path.join(appSettings.datalabRoot, '/content/datalab/.config/notary_secret');
  var processArgs = appSettings.jupyterArgs.slice().concat([
    '--port=' + server.port,
    '--port-retries=0',
    '--notebook-dir="' + server.notebooks + '"',
    '--NotebookNotary.algorithm=sha256',
    '--NotebookNotary.secret_file=' + secretPath,
    '--NotebookApp.base_url=' + appSettings.datalabBasePath,
  ]);

  var notebookEnv: any = process.env;
  var processOptions = {
    detached: false,
    env: notebookEnv
  };

  server.childProcess = childProcess.spawn('jupyter', processArgs, processOptions);
  server.childProcess.on('exit', exitHandler);
  logging.getLogger().info('Jupyter process started with pid %d and args %j',
                           server.childProcess.pid, processArgs);

  // Capture the output, so it can be piped for logging.
  pipeOutput(server.childProcess.stdout, server.port, /* error */ false);
  pipeOutput(server.childProcess.stderr, server.port, /* error */ true);

  // Create the proxy.
  var proxyOptions: httpProxy.ProxyServerOptions = {
    target: 'http://localhost:' + port + appSettings.datalabBasePath
  };

  server.proxy = httpProxy.createProxyServer(proxyOptions);
  server.proxy.on('proxyRes', responseHandler);
  server.proxy.on('error', errorHandler);

  tcp.waitUntilUsedOnHost(server.port, "localhost", 100, 15000).then(
    function() {
      jupyterServer = server;
      logging.getLogger().info('Jupyter server started.');
      callbackManager.invokeAllCallbacks(null);
    },
    function(e) {
      logging.getLogger().error(e, 'Failed to start Jupyter server.');
      callbackManager.invokeAllCallbacks(e);
    });
}

/**
 * Starts the Jupyter server, and then creates a proxy object enabling
 * routing HTTP and WebSocket requests to Jupyter.
 */
function createJupyterServer() {
  logging.getLogger().info('Checking content dir exists');
  var contentDir = settings.getContentDir();
  logging.getLogger().info('Checking dir %s exists', contentDir);
  if (!fs.existsSync(contentDir)) {
    logging.getLogger().info('Creating content dir %s', contentDir);
    try {
      fs.mkdirSync(contentDir, parseInt('0755', 8));
    } catch (e) {
      // This likely means the disk is not yet ready.
      // We'll fall back to /content for now.
      logging.getLogger().info('Content dir %s does not exist', contentDir);
      contentDir = '/content'
    }
  }

  var port = appSettings.nextJupyterPort || 9000;

  logging.getLogger().info('Launching Jupyter server at %d', port);
  try {
    createJupyterServerAtPort(port, contentDir);
  } catch (e) {
    logging.getLogger().error(e, 'Error creating the Jupyter process');
    callbackManager.invokeAllCallbacks(e);
  }
}

export function getPort(request: http.ServerRequest): number {
  return jupyterServer ? jupyterServer.port : 0;
}

/**
 * Starts a jupyter server instance.
 */
export function start(cb: common.Callback0) {
  if (jupyterServer) {
    process.nextTick(function() { cb(null); });
    return;
  }

  if (!callbackManager.checkOngoingAndRegisterCallback(cb)) {
    // There is already a start request ongoing. Return now to avoid multiple Jupyter
    // processes for the same user.
    return;
  }

  logging.getLogger().info('Starting jupyter server.');
  try {
    createJupyterServer();
  }
  catch (e) {
    logging.getLogger().error(e, 'Failed to start Jupyter server.');
    callbackManager.invokeAllCallbacks(e);
  }
}

/**
 * Initializes the Jupyter server manager.
 */
export function init(settings: common.AppSettings): void {
  appSettings = settings;
}

/**
 * Closes the Jupyter server manager.
 */
export function close(): void {
  var jupyterProcess = jupyterServer.childProcess;

  try {
    jupyterProcess.kill('SIGHUP');
  }
  catch (e) {
  }

  jupyterServer = null;
}


export function handleSocket(request: http.ServerRequest, socket: net.Socket, head: Buffer) {
  if (!jupyterServer) {
    // should never be here.
    logging.getLogger().error('Jupyter server was not created yet.');
    return;
  }
  jupyterServer.proxy.ws(request, socket, head);
}

export function handleRequest(request: http.ServerRequest, response: http.ServerResponse) {
  if (!jupyterServer) {
    // should never be here.
    logging.getLogger().error('Jupyter server was not created yet.');
    response.statusCode = 500;
    response.end();
    return;
  }

  jupyterServer.proxy.web(request, response, null);
}

function responseHandler(proxyResponse: http.ClientResponse,
                         request: http.ServerRequest, response: http.ServerResponse) {
    var origin: string = util.headerAsString(request.headers.origin);
  if (appSettings.allowOriginOverrides.length &&
      appSettings.allowOriginOverrides.indexOf(origin) != -1) {
    proxyResponse.headers['access-control-allow-origin'] = origin;
    proxyResponse.headers['access-control-allow-credentials'] = 'true';
  } else if (proxyResponse.headers['access-control-allow-origin'] !== undefined) {
    // Delete the allow-origin = * header that is sent (likely as a result of a workaround
    // notebook configuration to allow server-side websocket connections that are
    // interpreted by Jupyter as cross-domain).
    delete proxyResponse.headers['access-control-allow-origin'];
  }

  if (proxyResponse.statusCode != 200) {
    return;
  }
}

function errorHandler(error: Error, request: http.ServerRequest, response: http.ServerResponse) {
  logging.getLogger().error(error, 'Jupyter server returned error.')

  response.writeHead(500, 'Internal Server Error');
  response.end();
}

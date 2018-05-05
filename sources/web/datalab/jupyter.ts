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
/// <reference path="../../../third_party/externs/ts/node/node-http-proxy.d.ts" />
/// <reference path="../../../third_party/externs/ts/node/tcp-port-used.d.ts" />
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

interface JupyterServer {
  userId: string;
  port: number;
  notebooks: string;
  childProcess?: childProcess.ChildProcess;
  proxy?: httpProxy.ProxyServer;
}

/**
 * Jupyter servers key'd by user id (each server is associated with a single user)
 */
var jupyterServers: common.Map<JupyterServer> = {};

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

function createJupyterServerAtPort(port: number, userId: string, userDir: string) {
  var server: JupyterServer = {
    userId: userId,
    port: port,
    notebooks: userDir,
  };

  function exitHandler(code: number, signal: string): void {
    logging.getLogger().error('Jupyter process %d for user %s exited due to signal: %s',
                              server.childProcess.pid, userId, signal);
    delete jupyterServers[server.userId];
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
  logging.getLogger().info('Jupyter process for user %s started with pid %d and args %j',
                           userId, server.childProcess.pid, processArgs);

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
      jupyterServers[userId] = server;
      logging.getLogger().info('Jupyter server started for %s.', userId);
      callbackManager.invokeAllCallbacks(userId, null);
    },
    function(e) {
      logging.getLogger().error(e, 'Failed to start Jupyter server for user %s.', userId);
      callbackManager.invokeAllCallbacks(userId, e);
    });
}

/**
 * Starts the Jupyter server, and then creates a proxy object enabling
 * routing HTTP and WebSocket requests to Jupyter.
 */
function createJupyterServer(userId: string) {
  logging.getLogger().info('Checking user dir for %s exists', userId);
  var userDir = settings.getUserDir(userId);
  logging.getLogger().info('Checking dir %s exists', userDir);
  if (!fs.existsSync(userDir)) {
    logging.getLogger().info('Creating user dir %s', userDir);
    try {
      fs.mkdirSync(userDir, parseInt('0755', 8));
    } catch (e) {
      // This likely means the disk is not yet ready.
      // We'll fall back to /content for now.
      logging.getLogger().info('User dir %s does not exist', userDir);
      userDir = '/content'
    }
  }

  var port = appSettings.nextJupyterPort || 9000;

  logging.getLogger().info('Launching Jupyter server for %s at %d', userId, port);
  try {
    createJupyterServerAtPort(port, userId, userDir);
  } catch (e) {
    logging.getLogger().error(e, 'Error creating the Jupyter process for user %s', userId);
    callbackManager.invokeAllCallbacks(userId, e);
  }
}

export function getPort(request: http.ServerRequest): number {
  var userId = 'anonymous';
  var server = jupyterServers[userId];
  return server ? server.port : 0;
}

/**
 * Starts a jupyter server instance for given user.
 */
export function startForUser(userId: string, cb: common.Callback0) {
  var server = jupyterServers[userId];
  if (server) {
    process.nextTick(function() { cb(null); });
    return;
  }

  if (!callbackManager.checkOngoingAndRegisterCallback(userId, cb)) {
    // There is already a start request ongoing. Return now to avoid multiple Jupyter
    // processes for the same user.
    return;
  }

  logging.getLogger().info('Starting jupyter server for %s.', userId);
  try {
    createJupyterServer(userId);
  }
  catch (e) {
    logging.getLogger().error(e, 'Failed to start Jupyter server for user %s.', userId);
    callbackManager.invokeAllCallbacks(userId, e);
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
  for (var n in jupyterServers) {
    var jupyterServer = jupyterServers[n];
    var jupyterProcess = jupyterServer.childProcess;

    try {
      jupyterProcess.kill('SIGHUP');
    }
    catch (e) {
    }
  }

  jupyterServers = {};
}


export function handleSocket(request: http.ServerRequest, socket: net.Socket, head: Buffer) {
  var userId = 'anonymous';
  var server = jupyterServers[userId];
  if (!server) {
    // should never be here.
    logging.getLogger().error('Jupyter server was not created yet for user %s.', userId);
    return;
  }
  server.proxy.ws(request, socket, head);
}

export function handleRequest(request: http.ServerRequest, response: http.ServerResponse) {
  var userId = 'anonymous';
  var server = jupyterServers[userId];
  if (!server) {
    // should never be here.
    logging.getLogger().error('Jupyter server was not created yet for user %s.', userId);
    response.statusCode = 500;
    response.end();
    return;
  }

  server.proxy.web(request, response, null);
}

function responseHandler(proxyResponse: http.ClientResponse,
                         request: http.ServerRequest, response: http.ServerResponse) {
  if (appSettings.allowOriginOverrides.length &&
      appSettings.allowOriginOverrides.indexOf(request.headers['origin']) != -1) {
    proxyResponse.headers['access-control-allow-origin'] = request.headers['origin'];
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

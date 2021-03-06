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

import * as http from 'http';
import * as net from 'net';
import * as url from 'url';

import {AppSettings} from './appSettings';
import * as jupyter from './jupyter';
import * as logging from './logging';
import * as reverseProxy from './reverseProxy';
import * as sockets from './sockets';
import * as wsHttpProxy from './wsHttpProxy';

let server: http.Server;

/**
 * If it is the user's first request since the web server restarts,
 * need to start jupyter server for that user.
 * We don't track results here. Later requests will go through initialization
 * checks again, and if it is still initializing, those requests will be parked
 * and wait for initialization to complete or fail.
 */
function startInitializationForUser(request: http.ServerRequest): void {
  if (jupyter.getPort(request) == 0) {
    // Giving null callback so this is fire-and-forget.
    jupyter.start(null);
  }
}

/**
 * Check if workspace and jupyter server is initialized for the user.
 * If not, wait for initialization to be done and then proceed to pass
 * the request to jupyter server.
 */
function handleJupyterRequest(request: http.ServerRequest, response: http.ServerResponse): void {

  if (jupyter.getPort(request) == 0) {
    // Jupyter server is not created yet. Creating it for user and call self again.
    // Another 'start' may already be ongoing so this 'syncNow' will probably
    // be parked until the ongoing one is done.
    jupyter.start(function(e) {
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

  // If Jupyter is not initialized, do it as early as possible after authentication.
  startInitializationForUser(request);

  // Requests proxied to Jupyter
  // TODO(b/109975537): Remove unused paths.
  if ((requestPath === '/') ||
      (requestPath.indexOf('/api') === 0) ||
      (requestPath.indexOf('/tree') === 0) ||
      (requestPath.indexOf('/notebooks') === 0) ||
      (requestPath.indexOf('/nbconvert') === 0) ||
      (requestPath.indexOf('/nbextensions') === 0) ||
      (requestPath.indexOf('/files') === 0) ||
      (requestPath.indexOf('/edit') === 0) ||
      (requestPath.indexOf('/terminals') === 0) ||
      (requestPath.indexOf('/sessions') === 0) ||
      (requestPath.indexOf('/static') === 0)) {

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
  const parsedUrl = url.parse(request.url, true);
  const urlpath = parsedUrl.pathname;

  logging.logRequest(request, response);

  const reverseProxyPort: string = reverseProxy.getRequestPort(request, urlpath);
  if (sockets.isSocketIoPath(urlpath)) {
    // Will automatically be handled by socket.io.
  } else if (reverseProxyPort) {
    reverseProxy.handleRequest(request, response, reverseProxyPort);
  } else {
    handleRequest(request, response, urlpath);
  }
}

// The path that is used for the optional websocket proxy for HTTP requests.
const httpOverWebSocketPath: string = '/http_over_websocket';

function socketHandler(request: http.ServerRequest, socket: net.Socket, head: Buffer) {
  const parsedUrl = url.parse(request.url, true);
  // Avoid proxying websocket requests on this path, as it's handled locally rather than by Jupyter.
  if (parsedUrl.pathname !== httpOverWebSocketPath) {
    jupyter.handleSocket(request, socket, head);
  }
}

/**
 * Handles all requests sent to the proxy web server. Some requests are handled within
 * the server, while some are proxied to the Jupyter notebook server.
 * @param request the incoming HTTP request.
 * @param response the out-going HTTP response.
 */
function requestHandler(request: http.ServerRequest, response: http.ServerResponse) {
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
export function run(settings: AppSettings): void {
  jupyter.init(settings);
  reverseProxy.init(settings);

  server = http.createServer(requestHandler);
  // Disable HTTP keep-alive connection timeouts in order to avoid connection
  // flakes. Details: b/112151064
  server.keepAliveTimeout = 0;
  server.on('upgrade', socketHandler);

  sockets.init(server, settings);

  if (settings.allowHttpOverWebsocket) {
    new wsHttpProxy.WsHttpProxy(server, httpOverWebSocketPath, settings.allowOriginOverrides);
  }

  logging.getLogger().info('Starting server at http://localhost:%d',
                           settings.serverPort);
  process.on('SIGINT', () => process.exit());

  server.listen(settings.serverPort);
}

/**
 * Stops the server and associated Jupyter server.
 */
export function stop(): void {
  jupyter.close();
}

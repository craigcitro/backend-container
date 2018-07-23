/*
 * Copyright 2016 Google Inc. All rights reserved.
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
import * as httpProxy from 'http-proxy';

import {AppSettings} from './appSettings';
import * as util from './util';

let appSettings: AppSettings;
const proxy: httpProxy.ProxyServer = httpProxy.createProxyServer(null);
const regex = new RegExp('\/_proxy\/([0-9]+)($|\/)');

function errorHandler(error: Error, request: http.ServerRequest, response: http.ServerResponse) {
  response.writeHead(500, 'Reverse Proxy Error.');
  response.end();
}

function getPort(url: string) {
  if (url) {
    var sr: any = regex.exec(url);
    if (sr) {
      return sr[1];
    }
  }
  return null;
}

/**
 * Get port from request. If the request should be handled by reverse proxy, returns
 * the port as a string. Othewise, returns null.
 */
export function getRequestPort(request: http.ServerRequest, path: string): string {
  const referer: string = util.headerAsString(request.headers.referer);
  const port: string = getPort(path) || getPort(referer);
  return port;
}

/**
 * Handle request by sending it to the internal http endpoint.
 */
export function handleRequest(request: http.ServerRequest,
                              response: http.ServerResponse,
                              port: String) {
  request.url = request.url.replace(regex, '');
  const target = 'http://localhost:' + port;

  proxy.web(request, response, {
    target
  });
}

/**
 * Initialize the handler.
 */
export function init(settings: AppSettings) {
  appSettings = settings;
  proxy.on('error', errorHandler);
}

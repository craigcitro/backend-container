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
/// <reference path="common.d.ts" />

import fs = require('fs');
import http = require('http');
import logging = require('./logging');
import path = require('path');
import settings = require('./settings');
import url = require('url');

var appSettings: common.AppSettings;
var CONTENT_TYPES: common.Map<string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.html': 'text/html'
};

var contentCache: common.Map<Buffer> = {};

// Path to use for fetching static resources provided by Jupyter.
function jupyterDir(): string {
  var prefix = appSettings.datalabRoot || '/usr/local/lib/python2.7';
  return path.join(prefix, '/dist-packages/notebook')
}

function getContent(filePath: string, cb: common.Callback<Buffer>): void {
  var content = contentCache[filePath];
  if (content != null) {
    process.nextTick(function() {
      cb(null, content);
    });
  }
  else {
    fs.readFile(filePath, function(error, content) {
      if (error) {
        cb(error, null);
      }
      else {
        contentCache[filePath] = content;
        cb(null, content);
      }
    });
  }
}

/**
 * Sends a static file as the response.
 * @param filePath the full path of the static file to send.
 * @param response the out-going response associated with the current HTTP request.
 */
function sendFile(filePath: string, response: http.ServerResponse) {
  var extension = path.extname(filePath);
  var contentType = CONTENT_TYPES[extension.toLowerCase()] || 'application/octet-stream';

  getContent(filePath, function(error, content) {
    if (error) {
      logging.getLogger().error(error, 'Unable to send static file: %s', filePath);
      response.writeHead(500);
      response.end();
    }
    else {
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(content);
    }
  });
}

/**
 * Implements static file handling. We currently only serve static Jupyter resources.
 * 
 * @param request the incoming file request.
 * @param response the outgoing file response.
 */
function requestHandler(request: http.ServerRequest, response: http.ServerResponse): void {
  var pathname = url.parse(request.url).pathname;
  console.log('static request: ' + pathname);
  // Strip off the leading slash to turn pathname into a relative file path
  var relativePath = pathname.substr(1);
  var filePath = path.join(jupyterDir(), relativePath);
  fs.stat(filePath, function(e, stats) {
    if (e || !stats.isFile()) {
      response.writeHead(404);
      response.end();
    }

    sendFile(filePath, response);
  });
}

/**
 * Creates the static content request handler.
 * @param settings configuration settings for the application.
 * @returns the request handler to handle static requests.
 */
export function createHandler(settings: common.AppSettings): Function {
  appSettings = settings;
  return requestHandler;
}

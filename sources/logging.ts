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

/// <reference path="./externs/bunyan.d.ts" />
/// <reference path="common.d.ts" />

import bunyan = require('bunyan');
import http = require('http');

var logger: bunyan.ILogger = null;
var requestLogger: bunyan.ILogger = null;
var jupyterLogger: bunyan.ILogger = null;

/**
 * Gets the logger for generating debug logs.
 * @returns the logger configured for debugging logging.
 */
export function getLogger(): bunyan.ILogger {
  return logger;
}

/**
 * Logs a request and the corresponding response.
 * @param request the request to be logged.
 * @param response the response to be logged.
 */
export function logRequest(request: http.ServerRequest, response: http.ServerResponse): void {
  requestLogger.info({ url: request.url, method: request.method }, 'Received a new request');
  response.on('finish', function() {
    requestLogger.info({ url: request.url, method: request.method, status: response.statusCode });
  });
}

/**
 * Logs the output from Jupyter.
 * @param text the output text to log.
 * @param error whether the text is error text or not.
 */
export function logJupyterOutput(text: string, error: boolean): void {
  // All Jupyter output seems to be generated on stderr, so ignore the
  // error parameter, and log as info...
  jupyterLogger.info(text);
}

/**
 * Initializes loggers used within the application.
 */
export function initializeLoggers(settings: common.AppSettings): void {
  logger = bunyan.createLogger({ name: 'app', streams: [
      { level: settings.consoleLogLevel, type: 'stream', stream: process.stderr },
  ]});
  requestLogger = logger.child({ type: 'request' });
  jupyterLogger = logger.child({ type: 'jupyter' });
}

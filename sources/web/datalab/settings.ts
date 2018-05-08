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
/// <reference path="common.d.ts" />

import fs = require('fs');
import path = require('path');
import util = require('util');
import logging = require('./logging');

var SETTINGS_FILE = 'settings.json';
var BASE_PATH_FILE = 'basePath.json';

/**
 * Loads the configuration settings for the application to use.
 * On first run, this generates any dynamic settings and merges them into the settings result.
 * @returns the settings object for the application to use.
 */
export function loadAppSettings(): common.AppSettings {
  var settingsPath = path.join(__dirname, 'config', SETTINGS_FILE);
  var basePathFile = path.join(__dirname, 'config', BASE_PATH_FILE);

  if (!fs.existsSync(settingsPath)) {
    _logError('App settings file %s not found.', settingsPath);
    return null;
  }

  try {
    const settings = <common.AppSettings>JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}');
    if (!fs.existsSync(basePathFile)) {
      _log('Base path setting file not found, falling back to empty path.');
      settings.datalabBasePath = '';
    } else {
      settings.datalabBasePath = JSON.parse(fs.readFileSync(basePathFile, 'utf8'));
    }
    const settingsOverrides = process.env['DATALAB_SETTINGS_OVERRIDES'];
    if (settingsOverrides) {
      // Allow overriding individual settings via JSON provided as an environment variable.
      const overrides = JSON.parse(settingsOverrides);
      for (const key of Object.keys(overrides)) {
        (<any>settings)[key] = overrides[key];
      }
    }

    // Normalize the base path to include "/" characters.
    if (settings.datalabBasePath.indexOf("/") != 0) {
      settings.datalabBasePath = "/" + settings.datalabBasePath;
    }
    if (settings.datalabBasePath.lastIndexOf("/") != settings.datalabBasePath.length - 1) {
      settings.datalabBasePath = settings.datalabBasePath + "/";
    }
    return settings;
  }
  catch (e) {
    _logError(e);
    return null;
  }
}

/**
 * Get the base directory for local content.
 */
export function getContentDir(): string {
  const appSettings = loadAppSettings();
  return path.join(appSettings.datalabRoot, appSettings.contentDir);
}

// Exported for testing
export function ensureDirExists(fullPath: string): boolean {
  if (path.dirname(fullPath) == fullPath) {
    // This should only happen once we hit the root directory
    return true;
  }
  if (fs.existsSync(fullPath)) {
    if (!fs.lstatSync(fullPath).isDirectory()) {
      _log('Path ' + fullPath + ' is not a directory');
      return false;
    }
    return true;
  }
  if (!ensureDirExists(path.dirname(fullPath))) {
    return false;
  }
  fs.mkdirSync(fullPath);
  return true;
}

/**
 * Logs a debug message if the logger has been initialized,
 * else logs to console.log.
 */
function _log(...args: Object[]) {
  const logger = logging.getLogger();
  if (logger) {
    const msg = util.format.apply(util.format, args);
    logger.debug(msg);
  } else {
    console.log.apply(console, args);
  }
}

/**
 * Logs an error message if the logger has been initialized,
 * else logs to console.error.
 */
function _logError(...args: Object[]) {
  const logger = logging.getLogger();
  if (logger) {
    const msg = util.format.apply(util.format, args);
    logger.error(msg);
  } else {
    console.error.apply(console, args);
  }
}

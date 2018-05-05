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

import childProcess = require('child_process');
import fs = require('fs');
import http = require('http');
import path = require('path');
import querystring = require('querystring');
import url = require('url');
import util = require('util');
import logging = require('./logging');

var SETTINGS_FILE = 'settings.json';
var DEFAULT_USER_SETTINGS_FILE = 'userSettings.json';
var BASE_PATH_FILE = 'basePath.json';

let lastUpdateUserSettingPromise = Promise.resolve(false);

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
    settings.versionId = process.env['DATALAB_VERSION'] || '';
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
 * Get user directory which stores the user's notebooks.
 * the directory is root_dir + emailaddress, such as '/content/user@domain.com'.
 */
export function getUserDir(userId: string): string {
  const appSettings = loadAppSettings();
  return path.join(appSettings.datalabRoot, appSettings.contentDir);
}

/**
 * Loads the path of the configuration directory for the user.
 *
 * @returns the path of the user's config directory.
 */
export function getUserConfigDir(userId: string): string {
  var userDir = getUserDir(userId);
  var configPath = path.join(userDir, 'datalab', '.config');
  return configPath;
}

/**
 * Copies the default user settings into the user's directory.
 */
function getDefaultUserSettings(userId: string) {
  const defaultUserSettingsPath = path.join(__dirname, 'config', DEFAULT_USER_SETTINGS_FILE);
  _log('Getting default settings: ' + defaultUserSettingsPath);
  // Copy the default user settings file into user's directory.
  const defaultUserSettings = fs.readFileSync(defaultUserSettingsPath, {encoding: 'utf8'});
  const initialUserSettings = process.env.DATALAB_INITIAL_USER_SETTINGS;
  const mergedUserSettings : string = initialUserSettings ?
      mergeUserSettings(defaultUserSettings, initialUserSettings) : defaultUserSettings;
  return mergedUserSettings;
}

/**
 * Copies the default user settings into the user's directory.
 */
function copyDefaultUserSettings(userId: string) {
  var userSettingsPath = path.join(getUserConfigDir(userId), SETTINGS_FILE);
  _log('Copying default settings to: ' + userSettingsPath);
  fs.writeFileSync(userSettingsPath, getDefaultUserSettings(userId));
  // writeFileSync does not return a status; let's see if it wrote a file.
  if (!fs.existsSync(userSettingsPath)) {
    _log('Failed to write new user settings file ' + userSettingsPath);
  }
}

/**
 * Merges two sets of user settings, giving priority to the second.
 * Exported for testing.
 */
export function mergeUserSettings(defaultUserSettings: string, initialUserSettings: string): string {
  let parsedDefaultUserSettings;
  try {
    parsedDefaultUserSettings = JSON.parse(defaultUserSettings || '{}')
  } catch (e) {
    // File is corrupt, or a developer has updated the defaults file with an error
    _log('Error parsing default user settings:', e);
    // We can't merge here, and this will probably cause problems down the line, but
    // this should not happen, so hopefully the developer will see this and fix
    // the default settings file.
    return defaultUserSettings;
  }

  let parsedInitialUserSettings;
  try {
    parsedInitialUserSettings = JSON.parse(initialUserSettings || '{}')
  } catch (e) {
    // The user's initial settings are not valid, we will ignore them.
    _log('Error parsing initial user settings:', e);
    return defaultUserSettings;
  }

  // Override the default settings with the specified initial settings
  const merged = {...parsedDefaultUserSettings, ...parsedInitialUserSettings};
  return JSON.stringify(merged);
}

/**
 * Loads the configuration settings for the user.
 *
 * @returns the key:value mapping of settings for the user.
 */
export function loadUserSettings(userId: string): common.UserSettings {
  var settingsPath = path.join(getUserConfigDir(userId), SETTINGS_FILE);
  if (!fs.existsSync(settingsPath)) {
    _log('User settings file %s not found, copying default settings.', settingsPath);
    try {
      copyDefaultUserSettings(userId);
    }
    catch (e) {
      _log('Failed to copy default settings, using from existing location.', e);
      return <common.UserSettings>JSON.parse(getDefaultUserSettings(userId));
    }
  }

  try {
    const settings = <common.UserSettings>JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}');
    return settings;
  }
  catch (e) {
    _logError('Failed to load user settings from ' + settingsPath + ':', e);
    // Move the corrupt file to another name where the user can examine the
    // contents later to see what went wrong.
    renameBadUserSettings(settingsPath);
    return {} as common.UserSettings;
  }
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

function renameBadUserSettings(settingsPath: string) {
  let newPath = settingsPath + ".bad";
  let n = 0;
  const maxBackups = 10;
  while (fs.existsSync(newPath) && n < maxBackups) {
    n = n + 1;
    newPath = settingsPath + ".bad-" + n;
  }
  if (n >= maxBackups) {
    _logError('Too many backups already (%d), not renaming bad file %s',
        maxBackups, settingsPath);
  } else {
    fs.renameSync(settingsPath, newPath);
    if (fs.existsSync(newPath)) {
      _logError('Moved bad file %s to %s', settingsPath, newPath);
    } else {
      _logError('Failed to move bad file %s to %s', settingsPath, newPath);
    }
  }
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

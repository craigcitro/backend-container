// Copyright 2017 Google Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//  http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

define(() => {
  function postLoad(ipy, editor) {
    function navigateAlternate(alt) {
      var url = document.location.href.replace('/edit', alt);
      if (url.includes("?")) {
        url = url.slice(0, url.lastIndexOf("?"));
      }
      url = url + '?download=true';

      if (!editor.clean) {
        editor.save().then(function() {
          window.open(url);
        });
      }
      else {
        window.open(url);
      }
    }

    $('#saveButton').click(function() {
      editor.save();
    })

    $('#renameButton').click(function() {
      Jupyter.notebook.save_widget.rename();
    })

    $('#downloadButton').click(function() {
      navigateAlternate('/files');
    })
  }

  return {
    postLoad: postLoad
  };
});

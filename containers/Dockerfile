# Copyright 2017 Google Inc. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

FROM ubuntu:17.10
MAINTAINER Google Colaboratory Team <colaboratory-team@google.com>

# Container configuration
EXPOSE 8080

# Path configuration
ENV PATH $PATH:/tools/node/bin:/tools/google-cloud-sdk/bin:/opt/bin
ENV PYTHONPATH /env/python

# We need to set the gcloud path before disabling the components check below.
ENV CLOUDSDK_CONFIG /content/.config

# We add the full repo contents (for building) and clean it up later.
COPY . /backend-container

# Setup OS and core packages
ENV DEBIAN_FRONTEND=noninteractive

# We set this to avoid various encoding issues.
ENV LANG en_US.UTF-8

RUN apt-get update && \
    apt-get install --no-install-recommends -y -q \
        apt-utils \
        build-essential \
        ca-certificates \
        curl \
        gfortran \
        git \
        google-perftools \
        libatlas-base-dev \
        libcublas8.0 \
        libcudart8.0 \
        libcufft8.0 \
        libcufftw8.0 \
        libcurand8.0 \
        libcusolver8.0 \
        libfreetype6-dev \
        libhdf5-dev \
        liblapack-dev \
        libpng-dev \
        libsm6 \
        libxext6 \
        libxft-dev \
        libxml2-dev \
        libzmq5 \
        openssh-client \
        p7zip-full \
        pkg-config \
        python \
        python-dev \
        python-tk \
        python3 \
        python3-dev \
        python3-tk \
        rename \
        rsync \
        ttf-liberation \
        unzip \
        wget \
        zip \
        && \
    mkdir -p /tools && \

# Set up pip, as per: https://pip.pypa.io/en/stable/installing/
    curl -O https://bootstrap.pypa.io/get-pip.py && \
    python3 get-pip.py && \
    python2 get-pip.py && \

# Setup Google Cloud SDK
# Also apply workaround for gsutil failure brought by this version of Google Cloud.
# (https://code.google.com/p/google-cloud-sdk/issues/detail?id=538) in final step.
    wget -nv https://dl.google.com/dl/cloudsdk/release/google-cloud-sdk.zip && \
    unzip -qq google-cloud-sdk.zip -d tools && \
    rm google-cloud-sdk.zip && \
    tools/google-cloud-sdk/install.sh --usage-reporting=false \
        --path-update=false --bash-completion=false && \
    tools/google-cloud-sdk/bin/gcloud -q components update \
        gcloud core bq gsutil compute preview alpha beta && \
    # disable the gcloud update message
    tools/google-cloud-sdk/bin/gcloud config set component_manager/disable_update_check true && \

# Fetch tensorflow wheels.
    cp /backend-container/containers/install_tf.sh / && \
    gsutil cp gs://colab-tensorflow/2018-09-20T16:39:47-07:00/*whl / && \
    for v in 2 3; do for f in /*tensorflow*-cp${v}*.whl; do pip${v} download -d /tf_deps $f; done; done && \

# Install wheel for use below.
    python3 -m pip install --upgrade wheel && \
    python2 -m pip install --upgrade wheel && \

# Assume yes to all apt commands, to avoid user confusion around stdin.
    cp /backend-container/containers/90assumeyes /etc/apt/apt.conf.d/ && \

# Add a global pip.conf to avoid warnings on `pip list` and friends.
    cp /backend-container/containers/pip.conf /etc/ && \

# Setup Python packages.
#
# Order is important here: we always do the python3 variants *before* the
# python2 ones, so that installed scripts still default to python2.
    python3 -m pip install -U --upgrade-strategy only-if-needed --no-cache-dir \
        -r /backend-container/containers/requirements.txt && \
    python2 -m pip install -U --upgrade-strategy only-if-needed --no-cache-dir \
        -r /backend-container/containers/requirements.txt \
        -r /backend-container/containers/requirements2.txt && \

# Do IPython configuration and install build artifacts
# Then link stuff needed for nbconvert to a location where Jinja will find it.
# I'd prefer to just use absolute path in Jinja imports but those don't work.
    ipython profile create default && \
    jupyter notebook --generate-config && \
    mkdir /etc/jupyter && \
    cp /backend-container/containers/jupyter_notebook_config.py /etc/jupyter && \

# Set up Jupyter kernels for python2 and python3.
    python3 -m ipykernel install && python -m ipykernel install && \

# Set up IPython configuration directories.
    mkdir -p /etc/ipython && \
    cp /backend-container/containers/ipython.py /etc/ipython/ipython_config.py && \

# Setup Node.js using LTS 8.11.3 and NPM v5.7.1
    mkdir -p /tools/node && \
    wget -nv https://nodejs.org/dist/v8.11.3/node-v8.11.3-linux-x64.tar.gz -O node.tar.gz && \
    tar xzf node.tar.gz -C /tools/node --strip-components=1 && \
    rm node.tar.gz && \
# Remove once 'npm ci' is supported by the default npm version.
    npm install -g npm@v5.7.1 && \

# Set our locale to en_US.UTF-8.
    apt-get install -y locales && \
    locale-gen en_US.UTF-8 && \
    update-locale LANG=en_US.UTF-8 \
# Build a copy of the datalab node app.
    mkdir -p /datalab/web && \
    cd /backend-container/sources && \
    /tools/node/bin/npm ci && \
    /tools/node/bin/npm run transpile -- --outDir /datalab/web && \
    cp -a config package.json package-lock.json /datalab/web && \
    cd / && \
    /tools/node/bin/npm install -g forever && \

# Add and install build artifacts
    cp /backend-container/containers/run.sh /datalab && \
    cd /datalab/web && \
    /tools/node/bin/npm ci && \
    cd / && \

# Run `tox` to confirm that we're not packaging code which doesn't work with
# the python versions on the container. Tox is configured via:
# https://github.com/googlecolab/colabtools/blob/master/tox.ini.
    cp -a /backend-container/colabtools /colabtools && \
    cd /colabtools && \
# tox maintains its own virtualenvs, so doesn't need both py2 and py3 installs.
    python3 -m pip install tox && \
    tox -c /colabtools/tox.ini && \
    python3 -m pip uninstall -y tox && \
# Install colabtools
    python setup.py sdist && \
    python3 -m pip install /colabtools/dist/google-colab-0.0.1a1.tar.gz && \
    python2 -m pip install /colabtools/dist/google-colab-0.0.1a1.tar.gz && \
    jupyter nbextension install --py google.colab && \
    jupyter serverextension enable --system --py google.colab._serverextension && \
# We also tweak the Jupyter kernelspecs, which needs to happen after our
# datalab node app is configured.
    python3 /backend-container/containers/update_kernelspecs.py && \

# Set up our pip/python aliases. We just copy the same file to two places
# rather than play games with symlinks. Note that /usr/local/bin/pip will be
# overridden by a `pip` upgrade, so we keep this near the end of the Dockerfile.
    cp /backend-container/containers/pymultiplexer /usr/local/bin/pip && \
    cp /backend-container/containers/pymultiplexer /usr/local/bin/python && \

# Stage the go/drive-fs binary for use by google.colab helpers.
    mkdir -p /opt/google/drive && \
    mv /backend-container/drive /backend-container/roots.pem /opt/google/drive/ && \

# We want to include a few small datasets, so that a new user has a few files
# to explore.
    cp -a /backend-container/containers/sample_data /content/ && \
    cd /content/sample_data && \
    curl -OL https://dl.google.com/mlcc/mledu-datasets/california_housing_train.csv && \
    curl -OL https://dl.google.com/mlcc/mledu-datasets/california_housing_test.csv && \
    curl -OL https://dl.google.com/mlcc/mledu-datasets/mnist_train_small.csv && \
    curl -OL https://dl.google.com/mlcc/mledu-datasets/mnist_test.csv && \

# Let GRTE find locales that are installed in standard (non-GRTE) locations.
    mkdir -p /usr/grte/v4/lib64/ && ln -s /usr/lib/locale /usr/grte/v4/lib64/ && \

# Clean up
    apt-get autoremove -y && \
    rm -rf /backend-container/ && \
    rm -f /get-pip.py && \
    rm -rf /root/.cache/* && \
    rm -rf /tmp/* && \
    cd /

# Startup
ENV ENV /root/.bashrc
ENV SHELL /bin/bash
# TensorFlow uses less than half the RAM with tcmalloc relative to (the default)
# jemalloc, so we use it.
ENV LD_PRELOAD /usr/lib/x86_64-linux-gnu/libtcmalloc.so.4
ENTRYPOINT [ "/datalab/run.sh" ]

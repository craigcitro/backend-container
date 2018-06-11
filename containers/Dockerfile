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
ENV PATH $PATH:/tools/node/bin:/tools/google-cloud-sdk/bin
ENV PYTHONPATH /env/python

# We need to set the gcloud path before disabling the components check below.
# TODO(b/70862907): Drop this custom gcloud directory.
ENV CLOUDSDK_CONFIG /content/datalab/.config

# We add the full repo contents (for building) and clean it up later.
COPY . /backend-container

# Setup OS and core packages
ENV DEBIAN_FRONTEND=noninteractive
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
        pkg-config \
        python \
        python-dev \
        python-tk \
        python3 \
        python3-dev \
        python3-tk \
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
    gsutil cp gs://colab-tensorflow/2018-05-17T00:07:23-07:00/*whl / && \
    for v in 2 3; do for f in /*tensorflow*-cp${v}*.whl; do pip${v} download -d /tf_deps $f; done; done && \

# Install wheel for use below.
    python3 -m pip install --upgrade wheel && \
    python2 -m pip install --upgrade wheel && \

# Assume yes to all apt commands, to avoid user confusion around stdin.
    cp /backend-container/containers/90assumeyes /etc/apt/apt.conf.d/ && \

# Add a global pip.conf to avoid warnings on `pip list` and friends.
    cp /backend-container/containers/pip.conf /etc/ && \

# Setup Python packages. One package isn't available from PyPA, so we
# install it manually to save on install time.
#
# Order is important here: we always do the python3 variants *before* the
# python2 ones, so that installed scripts still default to python2.
    python2 -m pip install -U http://wheels.scipy.org/subprocess32-3.5.0-cp27-cp27mu-manylinux1_x86_64.whl && \
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
    mkdir -p /etc/ipython && \
    cp /backend-container/containers/ipython.py /etc/ipython/ipython_config.py && \

# Setup Node.js using LTS 6.10
    mkdir -p /tools/node && \
    wget -nv https://nodejs.org/dist/v6.10.0/node-v6.10.0-linux-x64.tar.gz -O node.tar.gz && \
    tar xzf node.tar.gz -C /tools/node --strip-components=1 && \
    rm node.tar.gz && \

# Set our locale to en_US.UTF-8.
    apt-get install -y locales && \
    locale-gen en_US.UTF-8 && \
    update-locale LANG=en_US.UTF-8 && \

# Build a copy of the datalab node app.
    mkdir -p /datalab/web && \
    cd /backend-container/sources && \
    /tools/node/bin/npm install && \
    /tools/node/bin/npm run transpile -- --outDir /datalab/web && \
    cp -a config package.json /datalab/web && \
    cd / && \
    /tools/node/bin/npm install -g forever && \

# Add and install build artifacts
    cp -a /backend-container/containers/content/* /datalab && \
    cd /datalab/web && \
    /tools/node/bin/npm install && \
    cd / && \

# Install colabtools. We also run `tox` to confirm that we're not packaging a
# version which doesn't work with the python versions on the container. tox is
# configured via: https://github.com/googlecolab/colabtools/blob/master/tox.ini
    cp -a /backend-container/colabtools /colabtools && \
    cd /colabtools && \
# tox maintains its own virtualenvs, so doesn't need both py2 and py3 installs.
    python3 -m pip install tox && \
    tox && \
    python2 -m pip uninstall -y tox && \
    python setup.py sdist && \
    python3 -m pip install /colabtools/dist/google-colab-0.0.1a1.tar.gz && \
    python2 -m pip install /colabtools/dist/google-colab-0.0.1a1.tar.gz && \
    jupyter nbextension install --py google.colab && \

# Set up our pip/python aliases. We just copy the same file to two places
# rather than play games with symlinks. Note that /usr/local/bin/pip will be
# overridden by a `pip` upgrade, so we keep this near the end of the Dockerfile.
    cp /backend-container/containers/pymultiplexer /usr/local/bin/pip && \
    cp /backend-container/containers/pymultiplexer /usr/local/bin/python && \

# Clean up
    apt-get autoremove -y && \
    rm -rf /backend-container/ && \
    rm -f /get-pip.py && \
    rm -rf /root/.cache/* && \
    rm -rf /tmp/* && \
    cd /

# We set this to avoid various encoding issues.
ENV LANG en_US.UTF-8

# Startup
ENV ENV /root/.bashrc
ENV SHELL /bin/bash
# TensorFlow uses less than half the RAM with tcmalloc relative to (the default)
# jemalloc, so we use it.
ENV LD_PRELOAD /usr/lib/x86_64-linux-gnu/libtcmalloc.so.4
ENTRYPOINT [ "/datalab/run.sh" ]

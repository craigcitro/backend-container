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

# Setup OS and core packages
RUN apt-get update && \
    apt-get install --no-install-recommends -y -q \
        apt-utils \
        build-essential \
        ca-certificates \
        curl \
        gfortran \
        git \
        libatlas-base-dev \
        libfreetype6-dev \
        liblapack-dev \
        libpng-dev \
        libxft-dev \
        libxml2-dev \
        openssh-client \
        pkg-config \
        python \
        python-dev \
        python-pip \
        python-setuptools \
        python-zmq \
        python3 \
        python3-dev \
        python3-pip \
        python3-setuptools \
        python3-zmq \
        ttf-liberation \
        unzip \
        wget \
        zip \
        && \
    mkdir -p /tools && \

# TODO(b/69087391): Drop this section on fetching source packages.
#
# Save GPL source packages: first, we add two deb-src lines, then update, and
# then fetch sources.
    mkdir -p /srcs && \
    cd /srcs && \
    echo "\n\ndeb-src http://archive.ubuntu.com/ubuntu/ artful main restricted\ndeb-src http://archive.ubuntu.com/ubuntu/ artful-updates main restricted" >>/etc/apt/sources.list && \
    apt-get update -y -qq && \
    apt-get source -d wget python-zmq ca-certificates pkg-config libpng-dev gcc && \
    cd / && \

# Update pip and pip3 to avoid noisy warnings for users.
    pip3 install --upgrade pip && \
    pip install --upgrade pip

# TODO(b/69087391): Clean up the ordering of the RUN commands below.

# Setup Python packages. One package isn't available as a wheel, so we
# install it manually to save on install time.
#
# Order is important here: we always do the python3 variants *before* the
# python2 ones, so that installed scripts still default to python2.
COPY requirements.txt /
RUN pip install http://wheels.scipy.org/subprocess32-3.5.0-cp27-cp27mu-manylinux1_x86_64.whl && \
    pip3 install -U --upgrade-strategy only-if-needed --no-cache-dir -r /requirements.txt && \
    pip install -U --upgrade-strategy only-if-needed --no-cache-dir -r /requirements.txt && \

# Set up Jupyter kernels for python2 and python3.
    python3 -m ipykernel install && python -m ipykernel install && \

# Setup Node.js using LTS 6.10
    mkdir -p /tools/node && \
    wget -nv https://nodejs.org/dist/v6.10.0/node-v6.10.0-linux-x64.tar.gz -O node.tar.gz && \
    tar xzf node.tar.gz -C /tools/node --strip-components=1 && \
    rm node.tar.gz && \

# Setup Google Cloud SDK
# Also apply workaround for gsutil failure brought by this version of Google Cloud.
# (https://code.google.com/p/google-cloud-sdk/issues/detail?id=538) in final step.
    wget -nv https://dl.google.com/dl/cloudsdk/release/google-cloud-sdk.zip && \
    unzip -qq google-cloud-sdk.zip -d tools && \
    rm google-cloud-sdk.zip && \
    tools/google-cloud-sdk/install.sh --usage-reporting=false \
        --path-update=false --bash-completion=false \
        --disable-installation-options && \
    tools/google-cloud-sdk/bin/gcloud -q components update \
        gcloud core bq gsutil compute preview alpha beta && \
    # disable the gcloud update message
    tools/google-cloud-sdk/bin/gcloud config set component_manager/disable_update_check true && \
    touch /tools/google-cloud-sdk/lib/third_party/google.py && \

# Set our locale to en_US.UTF-8.
    apt-get install -y locales && \
    locale-gen en_US.UTF-8 && \
    update-locale LANG=en_US.UTF-8 && \

# Add some unchanging bits - specifically node modules (that need to be kept in sync
# with packages.json manually, but help save build time, by preincluding them in an
# earlier layer).
    /tools/node/bin/npm install \
        ws@1.1.4 \
        http-proxy@1.13.2 \
        mkdirp@0.5.1 \
        node-uuid@1.4.7 \
        bunyan@1.7.1 \
        tcp-port-used@0.1.2 \
        node-cache@3.2.0 && \
    cd / && \
    /tools/node/bin/npm install -g forever && \
    /tools/node/bin/npm install -s chokidar@1.6.1 && \

# Clean up
    apt-get autoremove -y && \
    rm -rf /tmp/* && \
    rm -rf /root/.cache/* && \
    cd /


ENV LANG en_US.UTF-8

ADD ipython.py /etc/ipython/ipython_config.py

# Do IPython configuration and install build artifacts
# Then link stuff needed for nbconvert to a location where Jinja will find it.
# I'd prefer to just use absolute path in Jinja imports but those don't work.
RUN ipython profile create default && \
    jupyter notebook --generate-config && \
    mkdir /etc/jupyter
ADD jupyter_notebook_config.py /etc/jupyter

# Add build artifacts
ADD build/web/nb /datalab/web
ADD content/ /datalab

# Install the build artifacts
RUN cd /datalab/web && /tools/node/bin/npm install && cd /

# Install colabtools.
COPY google-colab-0.0.1a1.tar.gz /
RUN pip install /google-colab-0.0.1a1.tar.gz
RUN jupyter nbextension install --py google.colab

# Startup
ENV ENV /root/.bashrc
ENV SHELL /bin/bash
ENV CLOUDSDK_CONFIG /content/datalab/.config
ENTRYPOINT [ "/datalab/run.sh" ]
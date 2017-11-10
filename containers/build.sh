#!/bin/bash -e
cd $(dirname "$0")

# Clean the build directory before building the image, so that the
# prepare.sh script rebuilds web sources
BUILD_DIR=../build
rm -rf $BUILD_DIR
../sources/build.sh

mv ../build/ build

# Copy the license file into the container
cp ../third_party/license.txt content/license.txt

# Build the docker image
docker build ${DOCKER_BUILD_ARGS} -t datalab .

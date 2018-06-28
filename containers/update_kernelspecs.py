#!/usr/bin/env python3
"""Update kernelspecs with socket.io version information."""

import json
import os
import subprocess
import sys

from jupyter_client import kernelspec


def main(argv):
  if len(argv) != 1:
    print('Usage: {}'.format(argv[0]))
    return 1

  npm_output = subprocess.run(
      ['npm', 'ls', 'socket.io'], cwd='/datalab/web', stdout=subprocess.PIPE)
  socketio_version = npm_output.stdout.strip().decode('utf8').split('@')[-1]

  for name, path in kernelspec.find_kernel_specs().items():
    spec = kernelspec.get_kernel_spec(name)
    colab_metadata = spec.metadata.setdefault('colab', {})
    colab_metadata['socketio_version'] = socketio_version
    with open(os.path.join(path, 'kernel.json'), 'wt') as f:
      json.dump(spec.to_dict(), f, sort_keys=True, indent=1)


if __name__ == '__main__':
  exit(main(sys.argv))

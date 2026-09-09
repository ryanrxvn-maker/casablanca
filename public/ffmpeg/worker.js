// Same-origin copy of @ffmpeg/ffmpeg 0.12.15's ESM worker. Keep this worker,
// const.js and errors.js in sync when upgrading @ffmpeg/ffmpeg.
import { CORE_URL, FFMessageType } from "./const.js";
import { ERROR_UNKNOWN_MESSAGE_TYPE, ERROR_NOT_LOADED, ERROR_IMPORT_FAILURE } from "./errors.js";

let ffmpeg;

const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL }) => {
  const first = !ffmpeg;
  try {
    if (!_coreURL) _coreURL = CORE_URL;
    importScripts(_coreURL);
  } catch {
    if (!_coreURL || _coreURL === CORE_URL) _coreURL = CORE_URL.replace('/umd/', '/esm/');
    self.createFFmpegCore = (await import(/* @vite-ignore */ _coreURL)).default;
    if (!self.createFFmpegCore) throw ERROR_IMPORT_FAILURE;
  }

  const coreURL = _coreURL;
  const wasmURL = _wasmURL || _coreURL.replace(/.js$/g, ".wasm");
  const workerURL = _workerURL || _coreURL.replace(/.js$/g, ".worker.js");
  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
  });
  ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
  ffmpeg.setProgress((data) => self.postMessage({ type: FFMessageType.PROGRESS, data }));
  return first;
};

const exec = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const ffprobe = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.ffprobe(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const writeFile = ({ path, data }) => { ffmpeg.FS.writeFile(path, data); return true; };
const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });
const deleteFile = ({ path }) => { ffmpeg.FS.unlink(path); return true; };
const rename = ({ oldPath, newPath }) => { ffmpeg.FS.rename(oldPath, newPath); return true; };
const createDir = ({ path }) => { ffmpeg.FS.mkdir(path); return true; };
const listDir = ({ path }) => ffmpeg.FS.readdir(path).map((name) => {
  const stat = ffmpeg.FS.stat(`${path}/${name}`);
  return { name, isDir: ffmpeg.FS.isDir(stat.mode) };
});
const deleteDir = ({ path }) => { ffmpeg.FS.rmdir(path); return true; };
const mount = ({ fsType, options, mountPoint }) => {
  const fs = ffmpeg.FS.filesystems[fsType];
  if (!fs) return false;
  ffmpeg.FS.mount(fs, options, mountPoint);
  return true;
};
const unmount = ({ mountPoint }) => { ffmpeg.FS.unmount(mountPoint); return true; };

self.onmessage = async ({ data: { id, type, data: input } }) => {
  const trans = [];
  let data;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg) throw ERROR_NOT_LOADED;
    switch (type) {
      case FFMessageType.LOAD: data = await load(input); break;
      case FFMessageType.EXEC: data = exec(input); break;
      case FFMessageType.FFPROBE: data = ffprobe(input); break;
      case FFMessageType.WRITE_FILE: data = writeFile(input); break;
      case FFMessageType.READ_FILE: data = readFile(input); break;
      case FFMessageType.DELETE_FILE: data = deleteFile(input); break;
      case FFMessageType.RENAME: data = rename(input); break;
      case FFMessageType.CREATE_DIR: data = createDir(input); break;
      case FFMessageType.LIST_DIR: data = listDir(input); break;
      case FFMessageType.DELETE_DIR: data = deleteDir(input); break;
      case FFMessageType.MOUNT: data = mount(input); break;
      case FFMessageType.UNMOUNT: data = unmount(input); break;
      default: throw ERROR_UNKNOWN_MESSAGE_TYPE;
    }
  } catch (error) {
    self.postMessage({ id, type: FFMessageType.ERROR, data: error.toString() });
    return;
  }
  if (data instanceof Uint8Array) trans.push(data.buffer);
  self.postMessage({ id, type, data }, trans);
};

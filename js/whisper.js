/* ============================================================
   whisper.js — on-device transcription with transformers.js
   Model: onnx-community/whisper-tiny.en (Whisper tiny, English)
   Everything runs in this tab. No audio leaves the device.
   ============================================================ */
(function () {
  'use strict';

  var TT = (window.TT = window.TT || {});

  var LIB_VERSION = '4.3.0';
  var CDN_LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@' + LIB_VERSION + '/dist/transformers.min.js';

  var MODEL_ID = 'onnx-community/whisper-tiny.en';
  var FALLBACK_MODEL_ID = 'Xenova/whisper-tiny.en';

  var modPromise = null;
  var pipePromise = null;
  var pipe = null;
  var cancelFlag = false;

  function loadModule() {
    if (modPromise) return modPromise;

    modPromise = (function () {
      // The engine is a pinned ES module from jsDelivr. sw.js keeps a copy, so it
      // is served from the device after the first load, online or not.
      return import(/* webpackIgnore: true */ CDN_LIB)
        .then(function (mod) {
          try {
            mod.env.allowLocalModels = false;   // always pull the model from the Hub
            mod.env.allowRemoteModels = true;
            if (mod.env.backends && mod.env.backends.onnx && mod.env.backends.onnx.wasm) {
              mod.env.backends.onnx.wasm.numThreads = Math.min(4, (navigator.hardwareConcurrency || 2));
            }
          } catch (e) { /* non-fatal */ }
          return mod;
        })
        .catch(function (err) {
          modPromise = null;
          var e = new Error(TT.util.isWeb()
            ? 'The speech engine could not be loaded. It needs internet the first time. The audio is saved — you can write a summary by hand, or try again on Wi-Fi.'
            : 'On-device transcription needs the app opened over a web address — GitHub Pages, or a small local server. Opened straight from disk it cannot fetch the speech engine. The audio is saved; you can write a summary by hand.');
          e.detail = (err && err.message) || String(err);
          throw e;
        });
    })();

    return modPromise;
  }

  function getPipeline(onProgress) {
    if (pipe) return Promise.resolve(pipe);
    if (pipePromise) return pipePromise.then(function (p) {
      if (onProgress) onProgress({ stage: 'ready', percent: 100 });
      return p;
    });

    var files = {};   // name -> {loaded,total}
    var lastPct = 0;

    function report(info) {
      if (!onProgress) return;
      var status = info && info.status;
      var name = info && (info.file || info.name);

      if (status === 'initiate' && name) {
        if (!files[name]) files[name] = { loaded: 0, total: 0 };
      } else if (status === 'progress' && name) {
        files[name] = { loaded: info.loaded || 0, total: info.total || 0 };
      } else if (status === 'done' && name) {
        var f = files[name] || { total: 0 };
        if (f.total) f.loaded = f.total;
      } else if (status === 'ready') {
        onProgress({ stage: 'ready', percent: 100 });
        return;
      } else {
        return;
      }

      var loaded = 0, total = 0, unknown = false;
      Object.keys(files).forEach(function (k) {
        loaded += files[k].loaded || 0;
        total += files[k].total || 0;
        if (!files[k].total) unknown = true;
      });

      var pct = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
      if (pct < lastPct) pct = lastPct;
      lastPct = pct;

      onProgress({
        stage: 'download',
        percent: pct,
        indeterminate: total === 0 || unknown,
        loaded: loaded,
        total: total,
        file: name
      });
    }

    pipePromise = loadModule().then(function (mod) {
      return mod.pipeline('automatic-speech-recognition', MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: report
      }).catch(function (err) {
        console.warn('Primary model failed, trying fallback id', err);
        return mod.pipeline('automatic-speech-recognition', FALLBACK_MODEL_ID, {
          dtype: 'q8',
          device: 'wasm',
          progress_callback: report
        });
      });
    }).then(function (p) {
      pipe = p;
      if (onProgress) onProgress({ stage: 'ready', percent: 100 });
      return p;
    }).catch(function (err) {
      pipePromise = null;
      if (err && err.message) throw err;
      var e2 = new Error('The speech model could not be loaded. The audio is saved — you can write a summary by hand, or try again on Wi-Fi.');
      e2.detail = String(err);
      throw e2;
    });

    return pipePromise;
  }

  /** Decode any audio file the browser can read into 16 kHz mono. */
  function decodeToMono16k(blob) {
    var AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) return Promise.reject(new Error('This browser cannot decode audio files.'));
    return blob.arrayBuffer().then(function (buf) {
      var ctx;
      try {
        ctx = new AC(1, 1, 16000);   // decodeAudioData resamples to the context rate
      } catch (e) {
        return Promise.reject(new Error('This browser cannot decode that audio format.'));
      }
      return new Promise(function (resolve, reject) {
        // Callback form for older Safari, promise form for Chrome.
        var p;
        try {
          p = ctx.decodeAudioData(buf, function (b) { resolve(b); }, function (e) { reject(e || new Error('decode failed')); });
        } catch (e) {
          return reject(new Error('This browser cannot decode that audio format.'));
        }
        if (p && typeof p.then === 'function') p.then(resolve, function (e) { reject(e || new Error('decode failed')); });
      });
    }).then(function (audioBuffer) {
      var ch = audioBuffer.numberOfChannels;
      var len = audioBuffer.length;
      var data = new Float32Array(len);
      if (ch === 1) {
        data.set(audioBuffer.getChannelData(0));
        return data;
      }
      var chans = [];
      for (var c = 0; c < ch; c++) chans.push(audioBuffer.getChannelData(c));
      for (var i = 0; i < len; i++) {
        var v = 0;
        for (var k = 0; k < ch; k++) v += chans[k][i];
        data[i] = v / ch;
      }
      return data;
    });
  }

  function transcribeBlob(blob, onProgress) {
    cancelFlag = false;
    return getPipeline(onProgress).then(function (p) {
      if (cancelFlag) return { text: '', cancelled: true };
      if (onProgress) onProgress({ stage: 'decode' });
      return decodeToMono16k(blob).then(function (audio) {
        if (!audio.length) throw new Error('That file has no audio in it.');
        if (onProgress) onProgress({ stage: 'transcribe', seconds: audio.length / 16000 });
        return p(audio, {
          chunk_length_s: 30,
          stride_length_s: 5,
          return_timestamps: false
        }).then(function (out) {
          if (cancelFlag) return { text: '', cancelled: true };
          var text = '';
          if (Array.isArray(out)) text = out.map(function (o) { return o.text || ''; }).join(' ');
          else if (out && typeof out === 'object') text = out.text || '';
          else if (typeof out === 'string') text = out;
          return { text: String(text).replace(/\s+/g, ' ').trim(), cancelled: false };
        });
      });
    });
  }

  TT.Whisper = {
    modelId: MODEL_ID,
    transcribeBlob: transcribeBlob,
    decodeToMono16k: decodeToMono16k,
    /** warm the model up without audio (used by the "prepare" button) */
    prepare: function (onProgress) { return getPipeline(onProgress).then(function () { return true; }); },
    isLoaded: function () { return !!pipe; },
    cancel: function () { cancelFlag = true; }
  };
})();

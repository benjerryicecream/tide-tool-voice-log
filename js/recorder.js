/* ============================================================
   recorder.js — microphone capture (MediaRecorder), level meter,
   live transcription (Web Speech API).
   ============================================================ */
(function () {
  'use strict';

  var TT = (window.TT = window.TT || {});
  var util = TT.util;

  var MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4'
  ];

  function pickMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
    }
    return '';
  }

  // Looked up at call time: some browsers only expose the constructor after load.
  function getSR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  var Recorder = {
    supported: {
      mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)
    },

    /* runtime */
    _stream: null,
    _mr: null,
    _chunks: [],
    _started: 0,
    _timer: null,
    _ac: null,
    _analyser: null,
    _raf: 0,
    _rec: null,
    _finals: [],
    _interim: '',
    _liveOk: false,
    _liveNote: '',
    _restarting: false,
    _stopping: false,
    _onTick: null,
    _onTranscript: null,
    _onLevel: null,

    isRecording: function () { return !!this._mr && this._mr.state === 'recording'; },

    /* -------------------------------------------------------
       start / stop
       ------------------------------------------------------- */
    start: function (handlers) {
      var self = this;
      handlers = handlers || {};
      this._onTick = handlers.onTick || function () {};
      this._onTranscript = handlers.onTranscript || function () {};
      this._onLevel = handlers.onLevel || function () {};
      this._chunks = [];
      this._finals = [];
      this._interim = '';
      this._stopping = false;
      this._liveNote = '';

      if (!this.supported.mic) {
        return Promise.reject(new Error('This browser cannot record audio. Try Chrome on Android.'));
      }

      return navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      }).then(function (stream) {
        self._stream = stream;
        var mime = pickMime();
        var opts = mime ? { mimeType: mime } : {};
        try {
          self._mr = new MediaRecorder(stream, opts);
        } catch (e) {
          self._mr = new MediaRecorder(stream);
        }
        self._mr.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) self._chunks.push(ev.data);
        };
        self._mr.onerror = function (ev) {
          console.error('MediaRecorder error', ev.error || ev);
        };
        self._mr.start(1000);

        self._started = Date.now();
        self._tick();
        self._timer = setInterval(function () { self._tick(); }, 250);
        self._meter();
        self._startLive();

        // If the OS pulls the mic (call comes in, permission revoked), close cleanly.
        stream.getAudioTracks().forEach(function (tr) {
          tr.onended = function () {
            if (self.isRecording() && !self._stopping) {
              self._liveNote = 'The microphone was handed back to another app. Recording stopped.';
              self.stop().then(function (res) { handlers.onAutoStop && handlers.onAutoStop(res); });
            }
          };
        });

        return true;
      });
    },

    _tick: function () {
      var secs = (Date.now() - this._started) / 1000;
      this._onTick(secs);
    },

    _meter: function () {
      var self = this;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        this._ac = new AC();
        var src = this._ac.createMediaStreamSource(this._stream);
        this._analyser = this._ac.createAnalyser();
        this._analyser.fftSize = 1024;
        this._analyser.smoothingTimeConstant = 0.7;
        src.connect(this._analyser);
        var data = new Uint8Array(this._analyser.fftSize);
        var loop = function () {
          if (!self._analyser) return;
          self._analyser.getByteTimeDomainData(data);
          var sum = 0;
          for (var i = 0; i < data.length; i++) {
            var v = (data[i] - 128) / 128;
            sum += v * v;
          }
          var rms = Math.sqrt(sum / data.length);
          self._onLevel(Math.min(1, rms * 3.4));
          self._raf = requestAnimationFrame(loop);
        };
        this._raf = requestAnimationFrame(loop);
      } catch (e) {
        console.warn('Level meter unavailable', e);
      }
    },

    _startLive: function () {
      var self = this;
      var SR = getSR();
      if (!SR) {
        this._liveOk = false;
        this._liveNote = 'Live transcription is not available in this browser. The audio is still saved — transcribe it or write a summary after saving.';
        return;
      }
      var rec;
      try {
        rec = new SR();
      } catch (e) {
        this._liveOk = false;
        this._liveNote = 'Live transcription could not start in this browser. The audio is still saved.';
        return;
      }
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = function () {
        self._liveOk = true;
        self._liveNote = '';
      };

      rec.onresult = function (ev) {
        var interim = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          var res = ev.results[i];
          var txt = res[0] ? res[0].transcript : '';
          if (res.isFinal) {
            var clean = txt.trim();
            if (clean) self._finals.push(clean);
          } else {
            interim += txt;
          }
        }
        self._interim = interim;
        self._onTranscript(self.finalText(), interim.trim());
      };

      rec.onerror = function (ev) {
        var err = ev && ev.error;
        if (err === 'no-speech' || err === 'aborted') return;
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          self._liveOk = false;
          self._liveNote = 'Live transcription is blocked for this page (microphone or speech service permission). The audio is still saved.';
        } else if (err === 'network') {
          self._liveOk = false;
          self._liveNote = 'Live transcription lost its network connection. The audio is still saved.';
        } else {
          self._liveOk = false;
          self._liveNote = 'Live transcription stopped (' + err + '). The audio is still saved.';
        }
      };

      rec.onend = function () {
        // Chrome ends the session after silence or ~60s. Restart while we still record.
        if (self._stopping || !self.isRecording()) return;
        if (!self._liveOk && self._liveNote) return;
        self._restarting = true;
        setTimeout(function () {
          if (self._stopping || !self.isRecording()) { self._restarting = false; return; }
          try { rec.start(); } catch (e) { /* already started */ }
          self._restarting = false;
        }, 220);
      };

      this._rec = rec;
      try { rec.start(); } catch (e) {
        this._liveOk = false;
        this._liveNote = 'Live transcription could not start. The audio is still saved.';
      }
    },

    liveText: function () {
      var all = this._finals.join(' ').trim();
      if (this._interim) all = (all ? all + ' ' : '') + this._interim;
      return all.replace(/\s+/g, ' ').trim();
    },

    /** Text that will not change any more (final segments only). */
    finalText: function () { return this._finals.join(' ').replace(/\s+/g, ' ').trim(); },

    stop: function () {
      var self = this;
      this._stopping = true;
      clearInterval(this._timer);
      this._timer = null;

      if (this._rec) {
        try { this._rec.onend = null; this._rec.stop(); } catch (e) { /* ignore */ }
        this._rec = null;
      }

      var finished = new Promise(function (resolve) {
        var mr = self._mr;
        if (!mr || mr.state === 'inactive') return resolve();
        mr.onstop = function () { resolve(); };
        try { mr.stop(); } catch (e) { resolve(); }
      });

      var duration = (Date.now() - this._started) / 1000;

      return finished.then(function () {
        var type = (self._mr && self._mr.mimeType) || pickMime() || 'audio/webm';
        var blob = new Blob(self._chunks, { type: type });
        self._mr = null;
        self._chunks = [];

        self._teardown();

        return {
          blob: blob,
          mime: type,
          duration: duration,
          transcript: self.liveText(),
          finalTranscript: self.finalText(),
          liveWorked: self._liveOk && self._finals.length > 0,
          liveNote: self._liveNote
        };
      });
    },

    cancel: function () {
      this._stopping = true;
      clearInterval(this._timer);
      this._timer = null;
      if (this._rec) { try { this._rec.abort(); } catch (e) { /* ignore */ } this._rec = null; }
      if (this._mr && this._mr.state !== 'inactive') {
        this._mr.ondataavailable = null;
        try { this._mr.stop(); } catch (e) { /* ignore */ }
      }
      this._mr = null;
      this._chunks = [];
      this._finals = [];
      this._interim = '';
      this._teardown();
    },

    _teardown: function () {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._analyser = null;
      if (this._ac) {
        try { this._ac.close(); } catch (e) { /* ignore */ }
        this._ac = null;
      }
      if (this._stream) {
        this._stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* ignore */ } });
        this._stream = null;
      }
      this._onLevel(0);
    }
  };

  Object.defineProperty(Recorder.supported, 'live', {
    enumerable: true,
    get: function () { return !!getSR(); }
  });

  TT.Recorder = Recorder;
  TT.fmtDuration = util.duration;
})();

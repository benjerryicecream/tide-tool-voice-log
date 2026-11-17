/* ============================================================
   core.js — utilities, storage (IndexedDB + localStorage), model
   Tide & Tool Voice Log
   ============================================================ */
(function () {
  'use strict';

  var TT = (window.TT = window.TT || {});

  /* ---------------------------------------------------------
     Utilities
     --------------------------------------------------------- */
  var util = {};

  util.uid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  };

  util.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  util.pad = function (n) { return n < 10 ? '0' + n : '' + n; };

  /** 0:07 · 4:31 · 1:02:09 */
  util.duration = function (sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h ? h + ':' + util.pad(m) + ':' + util.pad(s) : m + ':' + util.pad(s);
  };

  util.bytes = function (n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };

  var dtCache = {};
  util.date = function (iso, opts) {
    var d = iso instanceof Date ? iso : new Date(iso);
    if (isNaN(d.getTime())) return '';
    var key = JSON.stringify(opts || {});
    var f = dtCache[key] || (dtCache[key] = new Intl.DateTimeFormat('en-US', opts));
    try { return f.format(d); } catch (e) { return d.toString(); }
  };

  /** "Mon, Nov 16 · 3:42 PM" */
  util.stamp = function (iso) {
    return util.date(iso, {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  };

  /** "Nov 16, 2026, 3:42 PM" — for exports */
  util.stampFull = function (iso) {
    return util.date(iso, {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  };

  /** Relative day label for grouping: Today / Yesterday / Mon, Nov 16 */
  util.dayLabel = function (iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var startOf = function (x) { return new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); };
    var days = Math.round((startOf(now) - startOf(d)) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return util.date(iso, { month: 'short', day: 'numeric' });
  };

  util.toLocalInput = function (iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d.getFullYear() + '-' + util.pad(d.getMonth() + 1) + '-' + util.pad(d.getDate()) +
      'T' + util.pad(d.getHours()) + ':' + util.pad(d.getMinutes());
  };

  util.fromLocalInput = function (v) {
    if (!v) return new Date().toISOString();
    var d = new Date(v);
    return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  util.debounce = function (fn, ms) {
    var t;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  util.slug = function (s) {
    return String(s || 'job').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'job';
  };

  util.safeFileName = function (base, ext) {
    var d = new Date();
    var stamp = d.getFullYear() + util.pad(d.getMonth() + 1) + util.pad(d.getDate());
    return base + '-' + stamp + '.' + ext;
  };

  util.download = function (blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1500);
  };

  util.textBlob = function (text) {
    // BOM keeps Windows Notepad honest about UTF-8
    return new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' });
  };

  util.blobToDataURL = function (blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(blob);
    });
  };

  util.dataURLToBlob = function (dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    var bin = atob(parts[1] || '');
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  };

  util.escapeRegExp = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); };

  util.norm = function (s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  };

  /** True only when the page is served over http(s) — i.e. the speech engine can be fetched. */
  util.isWeb = function () {
    return location.protocol === 'http:' || location.protocol === 'https:';
  };

  TT.util = util;

  /* ---------------------------------------------------------
     Audio store — IndexedDB, with a localStorage fallback so the
     app still works where IndexedDB is blocked (some file:// setups).
     --------------------------------------------------------- */
  var DB_NAME = 'tide-tool-voicelog';
  var DB_STORE = 'audio';
  var dbPromise = null;
  var dbBroken = false;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      var req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('IndexedDB open failed')); };
      req.onblocked = function () { reject(new Error('IndexedDB blocked')); };
    });
    return dbPromise;
  }

  function withStore(mode, fn) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, mode);
        var store = tx.objectStore(DB_STORE);
        var out;
        try { out = fn(store); } catch (e) { return reject(e); }
        tx.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('transaction aborted')); };
      });
    });
  }

  var LS_AUDIO = 'tt.audio.';

  var audio = {
    put: function (id, blob) {
      if (dbBroken) return audio._fallbackPut(id, blob);
      return withStore('readwrite', function (store) { return store.put(blob, id); })
        .catch(function (err) {
          console.warn('IndexedDB write failed, falling back to localStorage', err);
          dbBroken = true;
          return audio._fallbackPut(id, blob);
        });
    },
    get: function (id) {
      if (dbBroken) return audio._fallbackGet(id);
      return withStore('readonly', function (store) { return store.get(id); })
        .then(function (v) {
          if (v) return v;
          return audio._fallbackGet(id); // set before a fallback switch
        })
        .catch(function () { return audio._fallbackGet(id); });
    },
    remove: function (id) {
      try { localStorage.removeItem(LS_AUDIO + id); } catch (e) { /* ignore */ }
      if (dbBroken) return Promise.resolve();
      return withStore('readwrite', function (store) { return store.delete(id); })
        .catch(function () { /* ignore */ });
    },
    clear: function () {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf(LS_AUDIO) === 0) localStorage.removeItem(k);
      });
      if (dbBroken) return Promise.resolve();
      return withStore('readwrite', function (store) { return store.clear(); })
        .catch(function () { /* ignore */ });
    },
    _fallbackPut: function (id, blob) {
      return util.blobToDataURL(blob).then(function (dataUrl) {
        try {
          localStorage.setItem(LS_AUDIO + id, dataUrl);
        } catch (e) {
          throw new Error('This browser refused both IndexedDB and localStorage storage. The recording could not be saved on the device.');
        }
      });
    },
    _fallbackGet: function (id) {
      var raw = null;
      try { raw = localStorage.getItem(LS_AUDIO + id); } catch (e) { /* ignore */ }
      if (!raw) return Promise.resolve(null);
      try { return Promise.resolve(util.dataURLToBlob(raw)); } catch (e) { return Promise.resolve(null); }
    },
    mode: function () { return dbBroken ? 'localStorage' : 'IndexedDB'; }
  };

  TT.audioStore = audio;

  /* ---------------------------------------------------------
     State — metadata in localStorage
     --------------------------------------------------------- */
  var KEY = 'tt.voicelog.v1';
  var VERSION = 1;

  function blank() {
    return { version: VERSION, jobs: [], recordings: [], settings: { baseUrl: '', apiKey: '', model: '' } };
  }

  var state = blank();
  var lastSaved = null;

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* ignore */ }
    if (!raw) { state = blank(); return state; }
    try {
      var parsed = JSON.parse(raw);
      state = blank();
      state.jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
      state.recordings = Array.isArray(parsed.recordings) ? parsed.recordings : [];
      state.settings = Object.assign(state.settings, parsed.settings || {});
      state.recordings.forEach(function (r) {
        r.actionItems = Array.isArray(r.actionItems) ? r.actionItems : [];
      });
    } catch (e) {
      console.error('Could not parse stored log; starting empty.', e);
      state = blank();
    }
    return state;
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lastSaved = new Date();
      return true;
    } catch (e) {
      console.error('localStorage save failed', e);
      return false;
    }
  }

  var store = {
    get state() { return state; },
    get lastSaved() { return lastSaved; },
    load: load,
    save: persist,

    /* --- jobs --- */
    jobs: function () {
      return state.jobs.slice().sort(function (a, b) {
        return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
      });
    },
    jobById: function (id) {
      return state.jobs.filter(function (j) { return j.id === id; })[0] || null;
    },
    ensureJob: function (name) {
      var clean = String(name || '').replace(/\s+/g, ' ').trim();
      if (!clean) return null;
      var found = state.jobs.filter(function (j) { return util.norm(j.name) === util.norm(clean); })[0];
      if (found) { found.name = clean; return found; }
      var job = { id: util.uid(), name: clean, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      state.jobs.push(job);
      return job;
    },

    /* --- recordings --- */
    recordingsFor: function (jobId) {
      return state.recordings
        .filter(function (r) { return r.jobId === jobId; })
        .sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    },
    allRecordings: function () {
      return state.recordings.slice().sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    },
    recording: function (id) {
      return state.recordings.filter(function (r) { return r.id === id; })[0] || null;
    },
    addRecording: function (rec) {
      state.recordings.push(rec);
      var job = store.jobById(rec.jobId);
      if (job) job.updatedAt = new Date().toISOString();
      store.save();
      return rec;
    },
    updateRecording: function (id, patch) {
      var r = store.recording(id);
      if (!r) return null;
      Object.assign(r, patch);
      store.save();
      return r;
    },
    deleteRecording: function (id) {
      var idx = state.recordings.map(function (r) { return r.id; }).indexOf(id);
      if (idx === -1) return Promise.resolve();
      state.recordings.splice(idx, 1);
      store.save();
      return audio.remove(id);
    },

    /* --- derived --- */
    /** [{ job, recordings[] }] newest activity first, filtered by query */
    groups: function (query) {
      var q = util.norm(query);
      var jobs = [];
      var byJob = {};

      store.allRecordings().forEach(function (r) {
        var job = store.jobById(r.jobId);
        var jobName = job ? job.name : (r.jobName || 'Unfiled');
        if (!byJob[r.jobId]) {
          byJob[r.jobId] = { jobId: r.jobId, name: jobName, recordings: [] };
          jobs.push(byJob[r.jobId]);
        }
        byJob[r.jobId].recordings.push(r);
      });

      if (!q) return jobs;

      return jobs.map(function (g) {
        var jobHit = util.norm(g.name).indexOf(q) !== -1;
        var hits = g.recordings.filter(function (r) {
          if (jobHit) return true;
          return util.norm(r.transcript).indexOf(q) !== -1 ||
            util.norm(r.notes).indexOf(q) !== -1 ||
            util.norm(r.title).indexOf(q) !== -1 ||
            util.norm(r.summary).indexOf(q) !== -1 ||
            (r.actionItems || []).some(function (t) { return util.norm(t.text).indexOf(q) !== -1; });
        });
        if (!hits.length) return null;
        return { jobId: g.jobId, name: g.name, recordings: hits };
      }).filter(Boolean);
    },

    totals: function () {
      var rec = state.recordings;
      var bytes = rec.reduce(function (n, r) { return n + (r.size || 0); }, 0);
      var secs = rec.reduce(function (n, r) { return n + (r.duration || 0); }, 0);
      return { recordings: rec.length, jobs: state.jobs.length, bytes: bytes, seconds: secs };
    },

    /* --- settings --- */
    setSettings: function (patch) {
      Object.assign(state.settings, patch);
      store.save();
      return state.settings;
    },
    aiReady: function () {
      var s = state.settings;
      return !!(s.baseUrl && s.apiKey && s.model);
    },

    /* --- export / import --- */
    jobText: function (jobId) {
      var job = store.jobById(jobId);
      var recs = store.recordingsFor(jobId);
      var lines = [];
      lines.push('TIDE & TOOL HANDYMAN SERVICES — WORK LOG');
      lines.push('Client / job: ' + (job ? job.name : 'Unfiled'));
      lines.push('Exported: ' + util.stampFull(new Date().toISOString()));
      lines.push('Entries: ' + recs.length);
      lines.push('');
      recs.slice().reverse().forEach(function (r, i) {
        var kind = r.kind === 'call' ? 'CALL RECORDING' : 'VOICE NOTE';
        lines.push('================================================');
        lines.push('[' + (i + 1) + '] ' + kind + ' · ' + util.stampFull(r.createdAt) + ' · ' + util.duration(r.duration));
        lines.push('================================================');
        lines.push('');
        lines.push('TRANSCRIPT');
        lines.push(r.transcript ? r.transcript.trim() : '(not transcribed yet)');
        lines.push('');
        lines.push('NOTES');
        lines.push(r.notes ? r.notes.trim() : '(none)');
        if (r.summary) {
          lines.push('');
          lines.push('AI SUMMARY');
          lines.push(r.summary.trim());
        }
        var items = (r.actionItems || []);
        lines.push('');
        lines.push('ACTION ITEMS');
        if (!items.length) {
          lines.push('(none)');
        } else {
          items.forEach(function (t) { lines.push((t.done ? '[x] ' : '[ ] ') + t.text); });
        }
        lines.push('');
      });
      return lines.join('\r\n');
    },

    entryText: function (r) {
      var job = store.jobById(r.jobId);
      var lines = [];
      lines.push('TIDE & TOOL HANDYMAN SERVICES — WORK LOG');
      lines.push('Client / job: ' + (job ? job.name : (r.jobName || 'Unfiled')));
      lines.push('Type: ' + (r.kind === 'call' ? 'Call recording' : 'Voice note'));
      lines.push('Recorded: ' + util.stampFull(r.createdAt));
      lines.push('Length: ' + util.duration(r.duration));
      lines.push('');
      lines.push('TRANSCRIPT');
      lines.push(r.transcript ? r.transcript.trim() : '(not transcribed yet)');
      lines.push('');
      lines.push('NOTES');
      lines.push(r.notes ? r.notes.trim() : '(none)');
      if (r.summary) {
        lines.push('');
        lines.push('AI SUMMARY');
        lines.push(r.summary.trim());
      }
      lines.push('');
      lines.push('ACTION ITEMS');
      var items = r.actionItems || [];
      if (!items.length) lines.push('(none)');
      else items.forEach(function (t) { lines.push((t.done ? '[x] ' : '[ ] ') + t.text); });
      lines.push('');
      return lines.join('\r\n');
    },

    exportJSON: function (opts) {
      opts = opts || {};
      var payload = {
        app: 'tide-tool-voice-log',
        version: VERSION,
        exportedAt: new Date().toISOString(),
        settings: { baseUrl: state.settings.baseUrl, model: state.settings.model }, // never the key
        jobs: state.jobs,
        recordings: state.recordings,
        audio: {}
      };
      if (!opts.includeAudio) return Promise.resolve(payload);

      var tasks = state.recordings.map(function (r) {
        return audio.get(r.id).then(function (blob) {
          if (!blob) return null;
          return util.blobToDataURL(blob).then(function (dataUrl) { payload.audio[r.id] = dataUrl; });
        }).catch(function () { return null; });
      });
      return Promise.all(tasks).then(function () { return payload; });
    },

    importJSON: function (payload) {
      if (!payload || !Array.isArray(payload.recordings)) {
        throw new Error('That file does not look like a Tide & Tool backup.');
      }
      var addedJobs = 0, addedRecs = 0, addedAudio = 0;
      var knownIds = {};
      state.recordings.forEach(function (r) { knownIds[r.id] = true; });

      var zip = Promise.resolve();

      (payload.jobs || []).forEach(function (j) {
        var exists = state.jobs.some(function (x) { return x.id === j.id || util.norm(x.name) === util.norm(j.name); });
        if (!exists) {
          state.jobs.push({ id: j.id || util.uid(), name: j.name, createdAt: j.createdAt || new Date().toISOString(), updatedAt: j.updatedAt || new Date().toISOString() });
          addedJobs++;
        }
      });

      payload.recordings.forEach(function (r) {
        if (!r || !r.id) return;
        if (knownIds[r.id]) return;
        var job = state.jobs.filter(function (x) { return x.id === r.jobId; })[0];
        if (!job) {
          job = store.ensureJob(r.jobName || 'Imported');
        }
        var copy = Object.assign({}, r);
        copy.jobId = job ? job.id : r.jobId;
        copy.jobName = job ? job.name : (r.jobName || 'Imported');
        copy.actionItems = Array.isArray(copy.actionItems) ? copy.actionItems : [];
        state.recordings.push(copy);
        knownIds[copy.id] = true;
        addedRecs++;

        var dataUrl = payload.audio && payload.audio[r.id];
        if (dataUrl) {
          try {
            zip = zip.then(function () {
              return audio.put(copy.id, util.dataURLToBlob(dataUrl)).then(function () { addedAudio++; });
            }).catch(function (e) { console.warn('audio restore failed', e); });
          } catch (e) { console.warn('audio restore failed', e); }
        }
      });

      return zip.then(function () {
        if (payload.settings && !state.settings.baseUrl) {
          state.settings.baseUrl = payload.settings.baseUrl || '';
          state.settings.model = payload.settings.model || '';
        }
        store.save();
        return { jobs: addedJobs, recordings: addedRecs, audio: addedAudio };
      });
    }
  };

  TT.store = store;
})();

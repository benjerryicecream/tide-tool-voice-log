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

  /* ---------------------------------------------------------
     Phone numbers and Samsung call file names
     --------------------------------------------------------- */

  /** Digits only, with a leading US country code dropped: "+1 (808) 555-1234" → "8085551234" */
  util.phoneDigits = function (value) {
    var d = String(value == null ? '' : value).replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '1') d = d.slice(1);
    return d;
  };

  /** "(808) 555-1234" for a 10-digit US number, otherwise the input, tidied. */
  util.phonePretty = function (value) {
    var d = util.phoneDigits(value);
    if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  };

  /**
   * Samsung's call recorder writes Call_YYYYMMDD_HHMMSS_<number or contact name>.m4a
   * Returns { samsung, fileName, date, tail, phone, contactName }.
   * phone is a normalised 10-digit string (or ''); contactName is the name part
   * Samsung puts in when the number is already in the phone's contacts.
   */
  util.parseCallFile = function (fileName) {
    var name = String(fileName || '');
    var base = name.replace(/\.[a-z0-9]+$/i, '');
    var out = { samsung: false, fileName: name, date: null, tail: '', phone: '', contactName: '' };

    var m = base.match(/^Call[_\-\s]?(\d{4})(\d{2})(\d{2})[_\-\s](\d{2})(\d{2})(\d{2})(?:[_\-\s](.*))?$/i);
    if (m) {
      out.samsung = true;
      var d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      if (!isNaN(d.getTime())) out.date = d.toISOString();
      out.tail = (m[7] || '').trim();
    } else {
      out.tail = base;
    }

    var phoneish = /^[\d\s()+.\-]+$/;
    if (out.tail && phoneish.test(out.tail) && util.phoneDigits(out.tail).length >= 7) {
      out.phone = util.phoneDigits(out.tail);
    } else if (out.samsung && out.tail && !phoneish.test(out.tail)) {
      // Samsung stores the contact name in the file name when it knows the caller
      out.contactName = out.tail.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    }

    if (!out.phone) {
      // last resort: a number sitting anywhere in the file name
      var num = name.match(/(?:\+?1[\s.\-]?)?\(?(\d{3})\)?[\s.\-]?(\d{3})[\s.\-]?(\d{4})/);
      if (num) out.phone = num[1] + num[2] + num[3];
    }
    return out;
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

  /* Line tags. The recording itself never says which of the two lines the call
     came in on, so every imported call starts on the business line. */
  var LINES = [
    { value: '2nd line (Verizon business)', short: '2nd line' },
    { value: '1st line', short: '1st line' },
    { value: 'Unknown', short: 'line unknown' }
  ];
  var DEFAULT_LINE = LINES[0].value;

  function lineShort(value) {
    for (var i = 0; i < LINES.length; i++) if (LINES[i].value === value) return LINES[i].short;
    return value || '';
  }

  TT.LINES = LINES;
  TT.DEFAULT_LINE = DEFAULT_LINE;
  TT.lineShort = lineShort;

  function blank() {
    return { version: VERSION, jobs: [], recordings: [], clients: [], settings: { baseUrl: '', apiKey: '', model: '' } };
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
      state.clients = Array.isArray(parsed.clients) ? parsed.clients : [];
      state.settings = Object.assign(state.settings, parsed.settings || {});
      state.clients.forEach(function (c) {
        c.phone = util.phonePretty(c.phone);
      });
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

    /* --- phone book --- */
    clients: function () {
      return state.clients.slice().sort(function (a, b) {
        return util.norm(a.name).localeCompare(util.norm(b.name));
      });
    },
    clientById: function (id) {
      return state.clients.filter(function (c) { return c.id === id; })[0] || null;
    },
    findClientByPhone: function (phone) {
      var d = util.phoneDigits(phone);
      if (!d) return null;
      return state.clients.filter(function (c) { return util.phoneDigits(c.phone) === d; })[0] || null;
    },
    findClientByName: function (name) {
      var n = util.norm(name);
      if (!n) return null;
      return state.clients.filter(function (c) { return util.norm(c.name) === n; })[0] || null;
    },
    addClient: function (name, phone) {
      var clean = String(name || '').replace(/\s+/g, ' ').trim();
      var pretty = util.phonePretty(phone);
      if (!clean && !pretty) return null;
      var existing = store.findClientByPhone(phone) || (clean ? store.findClientByName(clean) : null);
      if (existing) {
        if (clean) existing.name = clean;
        if (pretty) existing.phone = pretty;
        existing.updatedAt = new Date().toISOString();
        store.save();
        return existing;
      }
      var c = {
        id: util.uid(),
        name: clean || pretty,
        phone: pretty,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.clients.push(c);
      store.save();
      return c;
    },
    updateClient: function (id, patch) {
      var c = store.clientById(id);
      if (!c) return null;
      if (patch.name !== undefined) c.name = String(patch.name || '').replace(/\s+/g, ' ').trim();
      if (patch.phone !== undefined) c.phone = util.phonePretty(patch.phone);
      c.updatedAt = new Date().toISOString();
      store.save();
      return c;
    },
    deleteClient: function (id) {
      var idx = state.clients.map(function (c) { return c.id; }).indexOf(id);
      if (idx === -1) return;
      state.clients.splice(idx, 1);
      store.save();
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
        if (r.kind === 'call') lines.push('Line: ' + (r.line || DEFAULT_LINE));
        if (r.clientPhone) lines.push('Client phone: ' + r.clientPhone);
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
      if (r.kind === 'call') lines.push('Line: ' + (r.line || DEFAULT_LINE));
      if (r.clientPhone) lines.push('Client phone: ' + r.clientPhone);
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
        clients: state.clients,
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

      var addedClients = 0;
      (payload.clients || []).forEach(function (c) {
        if (!c || !c.name) return;
        var exists = state.clients.some(function (x) { return x.id === c.id || util.phoneDigits(x.phone) === util.phoneDigits(c.phone) && util.phoneDigits(c.phone) !== ''; });
        if (!exists) {
          state.clients.push({
            id: c.id || util.uid(),
            name: c.name,
            phone: util.phonePretty(c.phone),
            createdAt: c.createdAt || new Date().toISOString(),
            updatedAt: c.updatedAt || new Date().toISOString()
          });
          addedClients++;
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
        return { jobs: addedJobs, recordings: addedRecs, audio: addedAudio, clients: addedClients };
      });
    }
  };

  TT.store = store;
})();

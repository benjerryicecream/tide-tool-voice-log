/* ============================================================
   ui.js — views, sheets, rendering, transcription queue
   ============================================================ */
(function () {
  'use strict';

  var TT = (window.TT = window.TT || {});
  var util = TT.util;
  var store = TT.store;

  var ICON = {
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><path d="M12 18v2.6" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    call: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h2.2l1.6 3.9-1.9 1.4a12 12 0 0 0 5.8 5.8l1.4-1.9 3.9 1.6v2.2a2.5 2.5 0 0 1-2.7 2.5C10.7 18.4 5.6 13.3 4 6.2A2.5 2.5 0 0 1 6.5 3.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4.2-4.2M12 15 7.8 10.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 18.5h15" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 13.7 9l5.5 1.7-5.5 1.7L12 18l-1.7-5.6L4.8 10.7 10.3 9 12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke="currentColor" stroke-width="1.7"/></svg>'
  };

  var el = {};
  var openSheets = 0;
  var curDetail = null;
  var detailUrl = null;
  var draft = null;
  var importQueue = [];
  var lastJobName = '';

  /* ---------------------------------------------------------
     Sheet helpers
     --------------------------------------------------------- */
  function openSheet(node) {
    if (!node) return;
    node.hidden = false;
    openSheets++;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () { node.classList.add('open'); });
  }

  function closeSheet(node) {
    if (!node) return;
    node.classList.remove('open');
    setTimeout(function () {
      node.hidden = true;
      openSheets = Math.max(0, openSheets - 1);
      if (openSheets === 0) document.body.style.overflow = '';
    }, 280);
  }

  var toastTimer;
  function toast(msg) {
    var t = el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3400);
  }

  /* ---------------------------------------------------------
     Log rendering
     --------------------------------------------------------- */
  function entryLine(rec) {
    var t = (rec.transcript || '').trim();
    if (t) return t;
    if (rec.notes && rec.notes.trim()) return rec.notes.trim();
    if (rec.transcriptStatus === 'working') return 'Transcribing on this device…';
    if (rec.transcriptStatus === 'failed') return 'Not transcribed yet — add a summary';
    return 'Not transcribed yet';
  }

  function statusFlag(rec) {
    if (rec.transcriptStatus === 'working') return '<span class="flag">transcribing…</span>';
    if (rec.transcriptStatus === 'failed') return '<span class="flag">needs summary</span>';
    if (rec.transcriptStatus === 'pending') return '<span class="flag">queued</span>';
    return '';
  }

  function renderLog() {
    var q = el.search.value.trim();
    var groups = store.groups(q);
    var total = store.state.recordings.length;

    el.clear.hidden = !q;

    if (!total) {
      el.list.innerHTML = '';
      el.empty.hidden = false;
      el.meta.textContent = '';
      return;
    }
    el.empty.hidden = true;

    var count = groups.reduce(function (n, g) { return n + g.recordings.length; }, 0);
    if (q) {
      el.meta.textContent = count + (count === 1 ? ' match' : ' matches') + ' for “' + q + '”';
    } else {
      var jn = store.state.jobs.length;
      el.meta.textContent = jn + (jn === 1 ? ' job' : ' jobs') + ' · ' + total + (total === 1 ? ' recording' : ' recordings');
    }

    if (!groups.length) {
      el.list.innerHTML = '<div class="no-results">Nothing matches “' + util.esc(q) + '”.</div>';
      return;
    }

    var html = groups.map(function (g) {
      var rows = g.recordings.map(function (r) {
        return '<button class="entry" data-open="' + util.esc(r.id) + '">' +
          '<span class="entry-ico ' + (r.kind === 'call' ? 'call' : 'voice') + '">' + (r.kind === 'call' ? ICON.call : ICON.mic) + '</span>' +
          '<span class="entry-main">' +
            '<span class="entry-text' + (r.transcript ? '' : ' pending') + '">' + util.esc(entryLine(r)) + '</span>' +
            '<span class="entry-sub">' +
              '<span>' + util.esc(util.stamp(r.createdAt)) + '</span>' +
              '<span class="dot-sep">·</span>' +
              '<span>' + util.duration(r.duration) + '</span>' +
              (r.kind === 'call' && r.line ? '<span class="dot-sep">·</span><span>' + util.esc(TT.lineShort(r.line)) + '</span>' : '') +
              statusFlag(r) +
            '</span>' +
          '</span>' +
          '<span class="entry-chev">' + ICON.chev + '</span>' +
        '</button>';
      }).join('');

      return '<section class="group">' +
        '<header class="group-head">' +
          '<h2 class="group-name">' + util.esc(g.name) + '</h2>' +
          '<span class="group-count">' + g.recordings.length + '</span>' +
          '<button class="group-act" data-export-job="' + util.esc(g.jobId) + '" title="Export this job as a text file">' + ICON.down + 'Export</button>' +
        '</header>' +
        rows +
      '</section>';
    }).join('');

    el.list.innerHTML = html;
  }

  function refreshJobChips() {
    var jobs = store.jobs().slice(0, 6);
    el.chips.innerHTML = jobs.map(function (j) {
      return '<button class="chip" data-chip="' + util.esc(j.name) + '">' + util.esc(j.name) + '</button>';
    }).join('');
    el.datalist.innerHTML = jobs.map(function (j) {
      return '<option value="' + util.esc(j.name) + '"></option>';
    }).join('');
  }

  /* ---------------------------------------------------------
     Recorder sheet
     --------------------------------------------------------- */
  var BARS = 30;
  function buildMeter() {
    var html = '';
    for (var i = 0; i < BARS; i++) html += '<span></span>';
    el.meter.innerHTML = html;
    el.bars = Array.prototype.slice.call(el.meter.children);
  }

  function levelToBars(level) {
    var n = el.bars.length;
    var scaled = Math.pow(level, 0.62);
    el.bars.forEach(function (b, i) {
      var center = 1 - Math.abs(i - (n - 1) / 2) / ((n - 1) / 2); // 0 at edges, 1 in middle
      var h = 4 + scaled * 38 * (0.35 + 0.65 * center);
      b.style.height = h.toFixed(1) + 'px';
    });
  }

  function openRecorder() {
    el.recTimer.textContent = '0:00';
    el.recStatus.textContent = 'Tap the button and start talking.';
    el.recLive.hidden = true;
    el.recLiveText.textContent = '';
    el.recNote.hidden = true;
    el.recNote.textContent = '';
    el.recBody.classList.remove('is-rec');
    el.recToggle.classList.remove('is-rec');
    el.recToggle.querySelector('.mic-ico').hidden = false;
    el.recToggle.querySelector('.stop-square').hidden = true;
    el.recFootLabel.textContent = 'Start recording';
    if (!TT.Recorder.supported.mic) {
      el.recStatus.textContent = 'This browser cannot record audio.';
      el.recNote.hidden = false;
      el.recNote.textContent = 'Use Chrome on Android, or import a call recording instead.';
    } else if (!TT.Recorder.supported.live) {
      el.recNote.hidden = false;
      el.recNote.textContent = 'This browser has no live transcription. You can still record — the audio is saved and you can transcribe it on the device afterwards.';
    }
    openSheet(el.sheetRecorder);
  }

  var recording = false;

  function startRecording() {
    if (recording) return;
    recording = true;
    el.recBody.classList.add('is-rec');
    el.recToggle.classList.add('is-rec');
    el.recToggle.querySelector('.mic-ico').hidden = true;
    el.recToggle.querySelector('.stop-square').hidden = false;
    el.recFootLabel.textContent = 'Tap to stop';
    el.recStatus.textContent = 'Recording. Talk normally — the phone can stay in your pocket.';
    el.recLive.hidden = true;
    el.recLiveText.textContent = '';
    el.recNote.hidden = true;

    TT.Recorder.start({
      onTick: function (secs) {
        el.recTimer.textContent = util.duration(secs);
      },
      onLevel: function (lvl) { levelToBars(lvl); },
      onTranscript: function (finalText, interim) {
        if (!finalText && !interim) return;
        el.recLive.hidden = false;
        el.recLiveText.innerHTML = util.esc(finalText) +
          (interim ? (finalText ? ' ' : '') + '<span class="interim">' + util.esc(interim) + '</span>' : '');
        el.recLive.scrollTop = el.recLive.scrollHeight;
      },
      onAutoStop: function (res) {
        recording = false;
        resetRecButton();
        el.recNote.hidden = false;
        el.recNote.textContent = TT.Recorder._liveNote || 'Recording stopped.';
        if (res && res.blob && res.blob.size) {
          openSave(makeDraft(res, 'voice'));
        }
      }
    }).then(function () {
      setTimeout(function () {
        if (!recording) return;
        if (TT.Recorder._liveNote) {
          el.recNote.hidden = false;
          el.recNote.textContent = TT.Recorder._liveNote;
        }
      }, 1200);
    }).catch(function (err) {
      recording = false;
      resetRecButton();
      el.recStatus.textContent = 'Could not start recording.';
      el.recNote.hidden = false;
      el.recNote.textContent = err && err.name === 'NotAllowedError'
        ? 'Microphone permission was denied. Allow the microphone for this page and tap again.'
        : (err && err.message) || 'Unknown microphone error.';
    });
  }

  function resetRecButton() {
    el.recBody.classList.remove('is-rec');
    el.recToggle.classList.remove('is-rec');
    el.recToggle.querySelector('.mic-ico').hidden = false;
    el.recToggle.querySelector('.stop-square').hidden = true;
    el.recFootLabel.textContent = 'Start recording';
    levelToBars(0);
  }

  function stopRecording() {
    if (!recording) return;
    recording = false;
    el.recStatus.textContent = 'Saving…';
    TT.Recorder.stop().then(function (res) {
      resetRecButton();
      if (!res.blob || !res.blob.size) {
        el.recStatus.textContent = 'Nothing was recorded.';
        el.recNote.hidden = false;
        el.recNote.textContent = 'The microphone produced no audio. Try again.';
        return;
      }
      closeSheet(el.sheetRecorder);
      setTimeout(function () { openSave(makeDraft(res, 'voice')); }, 160);
    }).catch(function (err) {
      resetRecButton();
      el.recStatus.textContent = 'Could not finish the recording.';
      el.recNote.hidden = false;
      el.recNote.textContent = (err && err.message) || String(err);
    });
  }

  function makeDraft(res, kind) {
    return {
      kind: kind,
      blob: res.blob,
      mime: res.mime,
      duration: res.duration || 0,
      transcript: res.transcript || '',
      createdAt: new Date().toISOString(),
      liveWorked: !!res.liveWorked,
      liveNote: res.liveNote || '',
      title: ''
    };
  }

  /* ---------------------------------------------------------
     Save sheet
     --------------------------------------------------------- */
  function openSave(d) {
    draft = d;
    el.saveTitle.textContent = d.kind === 'call' ? 'Save call recording' : 'Save voice note';
    // Who to credit it to: the matched client, then the name Samsung put in the
    // file name, and only fall back to the last job when the file says nothing
    // about the caller (a voice note, or a name-less call file).
    var prefill = '';
    if (d.client) prefill = d.client.name;
    else if (d.contactName) prefill = d.contactName;
    else if (!d.phone) prefill = lastJobName || '';
    el.saveJob.value = prefill;
    el.saveWhen.value = util.toLocalInput(d.createdAt);
    el.saveTranscript.value = d.transcript || '';
    el.saveNotes.value = '';

    // line tag: only imported calls carry one
    if (d.kind === 'call') {
      el.saveLineField.hidden = false;
      el.saveLine.innerHTML = TT.LINES.map(function (l) {
        return '<option value="' + util.esc(l.value) + '"' + ((d.line || TT.DEFAULT_LINE) === l.value ? ' selected' : '') + '>' + util.esc(l.value) + '</option>';
      }).join('');
    } else {
      el.saveLineField.hidden = true;
    }

    renderSaveMatch(d);

    if (d.kind === 'call') {
      el.saveTranscriptNote.textContent = 'not transcribed yet';
      el.saveTranscriptHint.textContent = 'This is transcribed on the device right after you save. You can edit the text now, or leave it and add a summary by hand if transcription fails.';
      el.saveTranscript.placeholder = 'Not transcribed yet';
      if (!util.isWeb()) {
        el.saveTranscriptHint.className = 'hint warn';
        el.saveTranscriptHint.textContent = 'Opened as a file, the transcription engine cannot download itself. Serve the folder over http(s) — GitHub Pages or a local server — to transcribe. The audio is saved either way.';
      } else {
        el.saveTranscriptHint.className = 'hint';
      }
    } else if (d.transcript) {
      el.saveTranscriptNote.textContent = 'live speech';
      el.saveTranscriptHint.className = 'hint';
      el.saveTranscriptHint.textContent = 'Check the words before saving — live transcription drops words when the signal is bad.';
    } else {
      el.saveTranscriptNote.textContent = 'not transcribed yet';
      el.saveTranscriptHint.className = 'hint';
      el.saveTranscriptHint.textContent = d.liveNote
        ? d.liveNote + ' Save anyway and transcribe it on this device later, or type a summary now.'
        : 'No live transcript for this note. The audio is saved either way — you can transcribe it on the device from the log, or type a summary now.';
    }

    refreshJobChips();
    updateSaveButton();
    openSheet(el.sheetSave);
    setTimeout(function () { el.saveJob.focus(); }, 320);
  }

  function updateSaveButton() {
    el.saveConfirm.disabled = !el.saveJob.value.trim();
  }

  /** Who the file says called, and what the phone book makes of it. */
  function renderSaveMatch(d) {
    var box = el.saveMatch;
    if (!box) return;
    var html = '';
    if (d.client) {
      html = '<div class="status-line info"><span>Phone book: <strong>' + util.esc(d.client.name) + '</strong>' +
        (d.client.phone ? ' · ' + util.esc(d.client.phone) : '') + '</span></div>';
    } else if (d.phone) {
      html = '<div class="status-line warn"><span>' + util.esc(util.phonePretty(d.phone)) +
        ' is not in the phone book.</span><button class="status-act" id="save-add-number">Add as client</button></div>';
    } else if (d.contactName) {
      html = '<div class="status-line warn"><span>“' + util.esc(d.contactName) +
        '” came from the file name and is not in the phone book.</span><button class="status-act" id="save-add-number">Add as client</button></div>';
    }
    box.innerHTML = html;
    box.hidden = !html;

    var add = document.getElementById('save-add-number');
    if (add) {
      add.addEventListener('click', function () {
        openClients({ name: d.contactName || '', phone: d.phone ? util.phonePretty(d.phone) : '' }, function (client) {
          if (!client) return;
          d.client = client;
          d.phone = util.phoneDigits(client.phone);
          el.saveJob.value = client.name;
          updateSaveButton();
          renderSaveMatch(d);
        });
      });
    }
  }

  /* ---------------------------------------------------------
     Phone book
     --------------------------------------------------------- */
  var clientEditId = null;
  var clientSavedCb = null;

  function openClients(prefill, onSaved) {
    clientEditId = null;
    clientSavedCb = onSaved || null;
    el.clientName.value = (prefill && prefill.name) || '';
    el.clientPhone.value = (prefill && prefill.phone) || '';
    el.clientSave.textContent = 'Add client';
    el.clientCancelEdit.hidden = true;
    el.clientPhoneHint.textContent = '';
    renderClients();
    openSheet(el.sheetClients);
    setTimeout(function () {
      if (!el.clientName.value) el.clientName.focus();
    }, 320);
  }

  function renderClients() {
    var list = store.clients();
    if (el.pbCount) el.pbCount.textContent = list.length;
    if (!list.length) {
      el.clientList.innerHTML = '<p class="client-empty">No clients yet. Add a name and a number here, or add one straight from an imported call.</p>';
      return;
    }
    el.clientList.innerHTML = list.map(function (c) {
      return '<div class="client-row">' +
        '<div class="client-main">' +
          '<div class="client-name">' + util.esc(c.name) + '</div>' +
          '<div class="client-phone">' + util.esc(c.phone || 'no number') + '</div>' +
        '</div>' +
        '<button class="icon-mini" data-cedit="' + util.esc(c.id) + '" aria-label="Edit ' + util.esc(c.name) + '">' + ICON.pencil + '</button>' +
        '<button class="icon-mini" data-cdel="' + util.esc(c.id) + '" aria-label="Remove ' + util.esc(c.name) + '">' + ICON.x + '</button>' +
      '</div>';
    }).join('');
  }

  function resetClientForm() {
    clientEditId = null;
    el.clientName.value = '';
    el.clientPhone.value = '';
    el.clientSave.textContent = 'Add client';
    el.clientCancelEdit.hidden = true;
  }

  function saveClientForm() {
    var name = el.clientName.value.replace(/\s+/g, ' ').trim();
    var phone = el.clientPhone.value.trim();
    if (!name) {
      el.clientName.focus();
      el.clientPhoneHint.textContent = 'A name is needed — the number alone is not enough to match a file name.';
      return;
    }
    var c;
    if (clientEditId) {
      c = store.updateClient(clientEditId, { name: name, phone: phone });
      toast('Client updated');
    } else {
      c = store.addClient(name, phone);
      toast(c && c.phone ? 'Added ' + c.name + ' · ' + c.phone : 'Added ' + name);
    }
    resetClientForm();
    renderClients();

    if (clientSavedCb) {
      var cb = clientSavedCb;
      clientSavedCb = null;
      closeSheet(el.sheetClients);
      cb(c);
    }
  }

  function commitSave() {
    var jobName = el.saveJob.value.replace(/\s+/g, ' ').trim();
    if (!jobName) { el.saveJob.focus(); return; }
    if (!draft) return;

    var job = store.ensureJob(jobName);
    var client = draft.client ||
      store.findClientByName(jobName) ||
      (draft.phone ? store.findClientByPhone(draft.phone) : null);
    var rec = {
      id: util.uid(),
      jobId: job.id,
      jobName: job.name,
      kind: draft.kind,
      createdAt: util.fromLocalInput(el.saveWhen.value) || draft.createdAt,
      importedAt: new Date().toISOString(),
      duration: Math.round(draft.duration || 0),
      mime: draft.mime || '',
      size: draft.blob.size || 0,
      line: draft.kind === 'call' ? (el.saveLine.value || TT.DEFAULT_LINE) : '',
      clientId: client ? client.id : '',
      clientName: client ? client.name : '',
      clientPhone: client ? client.phone : '',
      sourceFile: draft.title || '',
      transcript: el.saveTranscript.value.trim(),
      transcriptStatus: el.saveTranscript.value.trim() ? 'done' : (draft.kind === 'call' ? 'pending' : 'none'),
      transcriptSource: el.saveTranscript.value.trim() ? (draft.kind === 'voice' ? 'live' : 'manual') : null,
      transcriptError: '',
      notes: el.saveNotes.value.trim(),
      summary: '',
      actionItems: []
    };

    var btn = el.saveConfirm;
    btn.disabled = true;
    btn.textContent = 'Saving…';

    TT.audioStore.put(rec.id, draft.blob).then(function () {
      store.addRecording(rec);
      lastJobName = job.name;
      btn.textContent = 'Save to log';
      closeSheet(el.sheetSave);
      renderLog();
      draft = null;

      if (rec.kind === 'call' && !rec.transcript) {
        enqueueTranscription(rec.id);
        toast('Saved. Transcribing on this device — the model downloads once.');
      } else {
        toast('Saved to ' + job.name);
      }
      if (importQueue.length) {
        setTimeout(nextImport, 200);
      }
    }).catch(function (err) {
      console.error(err);
      btn.disabled = false;
      btn.textContent = 'Save to log';
      toast(err.message || 'Could not save the audio on this device.');
    });
  }

  /* ---------------------------------------------------------
     Import
     --------------------------------------------------------- */
  function handleFiles(files) {
    var arr = Array.prototype.slice.call(files || []).filter(function (f) {
      return f && (f.type.indexOf('audio') === 0 || /\.(m4a|mp3|wav|aac|ogg|opus|amr|3gp|webm|flac)$/i.test(f.name));
    });
    if (!arr.length) {
      toast('No audio files in that selection.');
      return;
    }
    importQueue = arr;
    nextImport();
  }

  function nextImport() {
    var file = importQueue.shift();
    if (!file) return;
    var remaining = importQueue.length;
    toast('Reading ' + file.name + (remaining ? ' (' + remaining + ' more)' : ''));

    // Call_YYYYMMDD_HHMMSS_<number or name>.m4a — the timestamp beats lastModified
    var parsed = util.parseCallFile(file.name);
    var created = parsed.date || (file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString());
    var mime = file.type || 'audio/mp4';

    var client = null;
    if (parsed.phone) client = store.findClientByPhone(parsed.phone);
    if (!client && parsed.contactName) client = store.findClientByName(parsed.contactName);

    probeDuration(file).then(function (secs) {
      var d = {
        kind: 'call',
        blob: file,
        mime: mime,
        duration: secs,
        transcript: '',
        createdAt: created,
        line: TT.DEFAULT_LINE,
        client: client,
        phone: parsed.phone || '',
        contactName: parsed.contactName || '',
        parsed: parsed,
        liveWorked: false,
        liveNote: 'Imported from ' + file.name,
        title: file.name
      };
      openSave(d);
      if (remaining) {
        el.saveTitle.textContent = 'Call recording 1 of ' + (remaining + 1);
      }
    });
  }

  function probeDuration(blob) {
    return new Promise(function (resolve) {
      var done = false;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('audio');
      function finish(v) {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        resolve(v);
      }
      a.preload = 'metadata';
      a.onloadedmetadata = function () { finish(isFinite(a.duration) ? a.duration : 0); };
      a.onerror = function () { finish(0); };
      setTimeout(function () { finish(0); }, 6000);
      a.src = url;
    });
  }

  /* ---------------------------------------------------------
     Transcription queue
     --------------------------------------------------------- */
  var tq = { ids: [], busy: false };
  var lastPaint = 0;

  function enqueueTranscription(id) {
    if (tq.ids.indexOf(id) === -1 && !tq.busy) tq.ids.push(id);
    else if (tq.ids.indexOf(id) === -1) tq.ids.push(id);
    runQueue();
  }
  function runQueue() {
    if (tq.busy) return;
    var id = tq.ids.shift();
    if (!id) return;
    var rec = store.recording(id);
    if (!rec) return runQueue();

    tq.busy = true;
    rec.transcriptStatus = 'working';
    rec.transcriptError = '';
    store.save();
    renderLog();
    if (curDetail && curDetail.id === id) renderDetailStatus(rec);

    var started = Date.now();

    TT.audioStore.get(id).then(function (blob) {
      if (!blob) throw new Error('The audio for this entry is missing on this device.');
      return TT.Whisper.transcribeBlob(blob, function (info) {
        rec.transcribeInfo = info;
        var now = Date.now();
        if (now - lastPaint > 400) {
          lastPaint = now;
          if (curDetail && curDetail.id === id) renderDetailStatus(rec);
        }
      });
    }).then(function (res) {
      if (res.cancelled) {
        rec.transcriptStatus = 'pending';
        rec.transcriptError = 'Transcription was stopped. The audio is kept.';
      } else if (!res.text) {
        rec.transcriptStatus = 'failed';
        rec.transcriptError = 'No speech was recognised in this file. The audio is kept — add a summary by hand.';
      } else {
        rec.transcript = res.text;
        rec.transcriptStatus = 'done';
        rec.transcriptSource = 'whisper';
        rec.transcriptError = '';
        rec.transcribedIn = Math.round((Date.now() - started) / 1000);
      }
    }).catch(function (err) {
      console.error('transcription failed', err);
      rec.transcriptStatus = 'failed';
      rec.transcriptError = (err && err.message) || 'Transcription failed. The audio is kept.';
    }).then(function () {
      delete rec.transcribeInfo;
      store.save();
      tq.busy = false;
      renderLog();
      if (curDetail && curDetail.id === id) {
        renderDetailStatus(rec);
        if (rec.transcriptStatus === 'done' && document.activeElement.id !== 'd-transcript') {
          var ta = document.getElementById('d-transcript');
          if (ta) ta.value = rec.transcript;
        }
      }
      runQueue();
    });
  }

  /* ---------------------------------------------------------
     Detail sheet
     --------------------------------------------------------- */
  function openDetail(id) {
    var rec = store.recording(id);
    if (!rec) return;
    curDetail = rec;

    if (detailUrl) { URL.revokeObjectURL(detailUrl); detailUrl = null; }

    var job = store.jobById(rec.jobId);
    var kindLabel = rec.kind === 'call' ? 'Call recording' : 'Voice note';
    var lineLabel = rec.kind === 'call' ? ' · ' + util.esc(TT.lineShort(rec.line || TT.DEFAULT_LINE)) : '';
    var lineOptions = TT.LINES.map(function (l) {
      return '<option value="' + util.esc(l.value) + '"' + ((rec.line || TT.DEFAULT_LINE) === l.value ? ' selected' : '') + '>' + util.esc(l.value) + '</option>';
    }).join('');
    var bookRow = rec.clientPhone
      ? '<div class="detail-book">Phone book: <strong>' + util.esc(rec.clientName || '') + '</strong> · ' + util.esc(rec.clientPhone) + '</div>'
      : '<div class="detail-book"><button class="link-btn" id="d-add-client">+ Add this client to the phone book</button></div>';

    var html =
      '<div class="detail-top">' +
        '<div class="detail-job">' + util.esc(job ? job.name : (rec.jobName || 'Unfiled')) + '</div>' +
        '<div class="detail-when">' + util.esc(util.stamp(rec.createdAt)) + ' · ' + util.duration(rec.duration) + ' · ' + kindLabel + lineLabel + '</div>' +
        bookRow +
      '</div>' +
      '<div class="audio-wrap" id="d-audio-wrap"><p class="hint">Loading audio…</p></div>' +
      (rec.kind === 'call'
        ? '<div class="field"><label for="d-line">Line</label><select id="d-line" class="input-select">' + lineOptions + '</select></div>'
        : '') +
      '<div id="detail-status"></div>' +
      '<div id="detail-summary"></div>' +
      '<div class="field">' +
        '<label for="d-transcript">Transcript <span class="label-note" id="d-t-note"></span></label>' +
        '<textarea id="d-transcript" rows="6" placeholder="Not transcribed yet. Type what was said."></textarea>' +
      '</div>' +
      '<div class="field">' +
        '<label for="d-notes">Notes</label>' +
        '<textarea id="d-notes" rows="3" placeholder="What you saw, what you quoted, what is next"></textarea>' +
      '</div>' +
      '<div class="field">' +
        '<label>Action items</label>' +
        '<div class="tasks" id="d-tasks"></div>' +
        '<div class="task-add"><input id="d-task-input" type="text" placeholder="Add an action item" autocomplete="off"><button id="d-task-add" aria-label="Add action item">+</button></div>' +
      '</div>' +
      '<div class="detail-actions">' +
        '<button class="btn-ai" id="d-ai">' + ICON.spark + 'Summarize</button>' +
        (rec.transcript ? '' : '<button class="btn-ai" id="d-asr">' + ICON.mic + 'Transcribe on this device</button>') +
        '<button class="btn-danger" id="d-delete">Delete this recording</button>' +
      '</div>';

    el.detailBody.innerHTML = html;
    el.detailTitle.textContent = kindLabel;
    el.detailExport.hidden = false;

    document.getElementById('d-transcript').value = rec.transcript || '';
    document.getElementById('d-notes').value = rec.notes || '';
    renderTranscriptNote(rec);
    renderDetailStatus(rec);
    renderSummary(rec);
    renderTasks(rec);

    TT.audioStore.get(rec.id).then(function (blob) {
      var wrap = document.getElementById('d-audio-wrap');
      if (!wrap) return;
      if (!blob) {
        wrap.innerHTML = '<p class="hint">The audio for this recording is not on this device any more. The transcript and notes are still here.</p>';
        return;
      }
      detailUrl = URL.createObjectURL(blob);
      wrap.innerHTML = '<audio controls preload="metadata" src="' + detailUrl + '"></audio>' +
        '<p class="hint" style="margin-top:8px">' + util.bytes(blob.size) + ' · ' + (rec.mime || blob.type || 'audio') +
        (rec.sourceFile ? ' · ' + util.esc(rec.sourceFile) : '') + '</p>';
    });

    // line tag and phone-book link
    var lineSel = document.getElementById('d-line');
    if (lineSel) {
      lineSel.addEventListener('change', function () {
        rec.line = lineSel.value;
        store.save();
        var when = document.querySelector('.detail-when');
        if (when) {
          when.textContent = util.stamp(rec.createdAt) + ' · ' + util.duration(rec.duration) + ' · ' +
            (rec.kind === 'call' ? 'Call recording' : 'Voice note') + ' · ' + TT.lineShort(rec.line);
        }
        renderLog();
        toast('Line set to ' + TT.lineShort(rec.line));
      });
    }

    var addClient = document.getElementById('d-add-client');
    if (addClient) {
      addClient.addEventListener('click', function () {
        var fromFile = rec.sourceFile ? util.parseCallFile(rec.sourceFile) : null;
        openClients(
          { name: job ? job.name : (rec.jobName || ''), phone: (fromFile && fromFile.phone) || '' },
          function (client) {
            if (!client) return;
            rec.clientId = client.id;
            rec.clientName = client.name;
            rec.clientPhone = client.phone;
            store.save();
            var row = document.querySelector('.detail-book');
            if (row) {
              row.innerHTML = 'Phone book: <strong>' + util.esc(client.name) + '</strong> · ' + util.esc(client.phone);
            }
            renderLog();
            toast('Linked to ' + client.name);
          }
        );
      });
    }

    // live-editing
    var t = document.getElementById('d-transcript');
    var n = document.getElementById('d-notes');
    t.addEventListener('input', util.debounce(function () {
      rec.transcript = t.value;
      if (!rec.transcript.trim()) {
        if (rec.transcriptStatus === 'done') rec.transcriptStatus = 'pending';
      } else {
        rec.transcriptStatus = 'done';
        if (!rec.transcriptSource || rec.transcriptSource === 'whisper') rec.transcriptSource = 'edited';
      }
      store.save();
      renderTranscriptNote(rec);
      renderDetailStatus(rec);
      renderLog();
    }, 400));
    n.addEventListener('input', util.debounce(function () {
      rec.notes = n.value;
      store.save();
      renderLog();
    }, 400));

    openSheet(el.sheetDetail);
  }

  function renderTranscriptNote(rec) {
    var note = document.getElementById('d-t-note');
    if (!note) return;
    if (rec.transcriptStatus === 'working') note.textContent = 'transcribing…';
    else if (!rec.transcript) note.textContent = 'not transcribed yet';
    else if (rec.transcriptSource === 'whisper') note.textContent = 'on-device Whisper';
    else if (rec.transcriptSource === 'live') note.textContent = 'live speech';
    else if (rec.transcriptSource === 'edited') note.textContent = 'edited';
    else note.textContent = 'typed';
  }

  function renderDetailStatus(rec) {
    var box = document.getElementById('detail-status');
    if (!box) return;
    var html = '';

    if (rec.transcriptStatus === 'working') {
      var info = rec.transcribeInfo || {};
      var pct = typeof info.percent === 'number' ? info.percent : 0;
      if (info.stage === 'download') {
        html = '<div class="status-line info"><span class="spin"></span><span>Downloading the speech model (once, ' +
          (info.total ? util.bytes(info.loaded) + ' of ' + util.bytes(info.total) : 'starting') +
          '). The audio is already saved.</span></div>' +
          '<div class="progress"><i style="width:' + Math.max(3, pct) + '%"></i></div>';
      } else if (info.stage === 'decode') {
        html = '<div class="status-line info"><span class="spin"></span><span>Reading the audio file…</span></div>';
      } else if (info.stage === 'transcribe') {
        html = '<div class="status-line info"><span class="spin"></span><span>Transcribing on this device (' +
          util.duration(info.seconds || rec.duration) + ' of audio). Nothing is uploaded. Long calls take a while.</span></div>' +
          '<button class="btn-secondary" id="d-stop-asr" style="margin-top:10px">Stop transcribing</button>';
      } else {
        html = '<div class="status-line info"><span class="spin"></span><span>Getting the speech engine ready…</span></div>';
      }
    } else if ((rec.transcriptStatus === 'pending' || rec.transcriptStatus === 'none') && !rec.transcript) {
      html = '<div class="status-line warn"><span>Not transcribed yet. ' +
        (rec.transcriptError ? util.esc(rec.transcriptError) + ' ' : '') +
        'The audio is saved on this device.</span></div>';
    } else if (rec.transcriptStatus === 'failed') {
      html = '<div class="status-line err"><span>' + util.esc(rec.transcriptError || 'Transcription failed. The audio is kept.') + '</span></div>';
    }

    box.innerHTML = html;

    var stop = document.getElementById('d-stop-asr');
    if (stop) stop.addEventListener('click', function () {
      TT.Whisper.cancel();
      toast('Stopping transcription — the audio stays saved.');
    });
  }

  function renderSummary(rec) {
    var box = document.getElementById('detail-summary');
    if (!box) return;
    if (!rec.summary) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="summary-box"><div class="sum-head">AI summary</div>' + util.esc(rec.summary) + '</div>';
  }

  function renderTasks(rec) {
    var box = document.getElementById('d-tasks');
    if (!box) return;
    var items = rec.actionItems || [];
    if (!items.length) {
      box.innerHTML = '<p class="hint" style="margin:0 0 10px">No action items yet.</p>';
      return;
    }
    box.innerHTML = items.map(function (t) {
      return '<div class="task' + (t.done ? ' done' : '') + '" data-task="' + util.esc(t.id) + '">' +
        '<button class="task-check" data-check="' + util.esc(t.id) + '" role="checkbox" aria-checked="' + (t.done ? 'true' : 'false') + '" aria-label="Toggle done">' + ICON.check + '</button>' +
        '<span class="task-text">' + util.esc(t.text) + '</span>' +
        '<button class="task-del" data-del="' + util.esc(t.id) + '" aria-label="Delete item">' + ICON.x + '</button>' +
      '</div>';
    }).join('');
  }

  /* ---------------------------------------------------------
     Settings
     --------------------------------------------------------- */
  function openSettings() {
    var s = store.state.settings;
    el.setBase.value = s.baseUrl || '';
    el.setKey.value = s.apiKey || '';
    el.setModel.value = s.model || '';
    updateAiTag();
    renderStats();
    if (el.pbCount) el.pbCount.textContent = store.state.clients.length;
    openSheet(el.sheetSettings);
  }

  function updateAiTag() {
    var on = store.aiReady();
    el.aiState.textContent = on ? 'on' : 'off';
    el.aiState.className = 'tag' + (on ? ' on' : '');
  }

  function renderStats() {
    var t = store.totals();
    var html = '<dt>Recordings</dt><dd>' + t.recordings + '</dd>' +
      '<dt>Jobs</dt><dd>' + t.jobs + '</dd>' +
      '<dt>Audio</dt><dd>' + util.bytes(t.bytes) + '</dd>' +
      '<dt>Recorded time</dt><dd>' + util.duration(t.seconds) + '</dd>' +
      '<dt>Storage</dt><dd>' + TT.audioStore.mode() + '</dd>';
    el.stats.innerHTML = html;

    el.storageNote.textContent = '';
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(function (est) {
        if (!est || !est.quota) return;
        el.storageNote.textContent = util.bytes(est.usage) + ' used of about ' +
          util.bytes(est.quota) + ' available to this site.';
      }).catch(function () { /* ignore */ });
    }
  }

  function exportJson() {
    var includeAudio = el.includeAudio.checked;
    toast(includeAudio ? 'Packing audio… this can take a moment.' : 'Packing log…');
    store.exportJSON({ includeAudio: includeAudio }).then(function (payload) {
      var blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      util.download(blob, util.safeFileName('tide-tool-log', 'json'));
      toast('Backup downloaded' + (includeAudio ? ' with audio' : ' (text only)'));
    }).catch(function (err) {
      toast('Backup failed: ' + (err.message || err));
    });
  }

  function importJsonFile(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var payload;
      try {
        payload = JSON.parse(String(fr.result).replace(/^\ufeff/, ''));
      } catch (e) {
        toast('That file is not valid JSON.');
        return;
      }
      store.importJSON(payload).then(function (res) {
        renderLog();
        renderStats();
        toast('Imported ' + res.recordings + ' recording' + (res.recordings === 1 ? '' : 's') +
          (res.audio ? ', ' + res.audio + ' with audio' : ''));
      }).catch(function (err) {
        toast(err.message || 'Import failed.');
      });
    };
    fr.onerror = function () { toast('Could not read that file.'); };
    fr.readAsText(file);
  }

  /* ---------------------------------------------------------
     Wiring
     --------------------------------------------------------- */
  function cacheEls() {
    el = {
      search: document.getElementById('search'),
      clear: document.getElementById('search-clear'),
      list: document.getElementById('log-list'),
      empty: document.getElementById('log-empty'),
      meta: document.getElementById('log-meta'),
      toast: document.getElementById('toast'),
      meter: document.getElementById('rec-meter'),
      recBody: document.querySelector('#sheet-recorder .rec-body'),
      recTimer: document.getElementById('rec-timer'),
      recStatus: document.getElementById('rec-status'),
      recLive: document.getElementById('rec-live'),
      recLiveText: document.getElementById('rec-live-text'),
      recNote: document.getElementById('rec-note'),
      recToggle: document.getElementById('rec-toggle'),
      recFootLabel: document.getElementById('rec-foot-label'),
      sheetRecorder: document.getElementById('sheet-recorder'),
      sheetSave: document.getElementById('sheet-save'),
      sheetDetail: document.getElementById('sheet-detail'),
      sheetSettings: document.getElementById('sheet-settings'),
      saveTitle: document.getElementById('save-title'),
      saveJob: document.getElementById('save-job'),
      saveWhen: document.getElementById('save-when'),
      saveTranscript: document.getElementById('save-transcript'),
      saveTranscriptNote: document.getElementById('save-transcript-note'),
      saveTranscriptHint: document.getElementById('save-transcript-hint'),
      saveNotes: document.getElementById('save-notes'),
      saveConfirm: document.getElementById('save-confirm'),
      chips: document.getElementById('save-chips'),
      datalist: document.getElementById('jobs-datalist'),
      saveMatch: document.getElementById('save-match'),
      saveAddClient: document.getElementById('save-add-client'),
      saveLineField: document.getElementById('save-line-field'),
      saveLine: document.getElementById('save-line'),
      sheetClients: document.getElementById('sheet-clients'),
      clientName: document.getElementById('client-name'),
      clientPhone: document.getElementById('client-phone'),
      clientPhoneHint: document.getElementById('client-phone-hint'),
      clientSave: document.getElementById('client-save'),
      clientCancelEdit: document.getElementById('client-cancel-edit'),
      clientList: document.getElementById('client-list'),
      pbCount: document.getElementById('pb-count'),
      detailBody: document.getElementById('detail-body'),
      detailTitle: document.getElementById('detail-title'),
      detailExport: document.getElementById('detail-export'),
      setBase: document.getElementById('set-base'),
      setKey: document.getElementById('set-key'),
      setModel: document.getElementById('set-model'),
      aiState: document.getElementById('ai-state'),
      stats: document.getElementById('set-stats'),
      storageNote: document.getElementById('storage-note'),
      includeAudio: document.getElementById('set-include-audio'),
      fileInput: document.getElementById('file-input'),
      importJsonInput: document.getElementById('import-json-input')
    };
  }

  function bind() {
    document.getElementById('btn-record').addEventListener('click', openRecorder);
    document.getElementById('btn-settings').addEventListener('click', openSettings);
    document.getElementById('btn-import').addEventListener('click', function () { el.fileInput.click(); });

    el.fileInput.addEventListener('change', function (e) {
      handleFiles(e.target.files);
      e.target.value = '';
    });

    el.search.addEventListener('input', renderLog);
    el.clear.addEventListener('click', function () {
      el.search.value = '';
      renderLog();
      el.search.focus();
    });

    el.list.addEventListener('click', function (e) {
      var open = e.target.closest('[data-open]');
      if (open) { openDetail(open.getAttribute('data-open')); return; }
      var exp = e.target.closest('[data-export-job]');
      if (exp) {
        var jobId = exp.getAttribute('data-export-job');
        var job = store.jobById(jobId);
        if (!job) return;
        var text = store.jobText(jobId);
        util.download(util.textBlob(text), util.safeFileName('tide-tool-' + util.slug(job.name), 'txt'));
        toast('Exported “' + job.name + '” as text');
      }
    });

    el.recToggle.addEventListener('click', function () {
      if (recording) stopRecording(); else startRecording();
    });

    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () {
        var which = b.getAttribute('data-close');
        if (which === 'recorder') {
          if (recording) {
            recording = false;
            TT.Recorder.cancel();
            resetRecButton();
            closeSheet(el.sheetRecorder);
            return;
          }
          closeSheet(el.sheetRecorder);
        } else if (which === 'save') {
          closeSheet(el.sheetSave);
          draft = null;
          if (importQueue.length) setTimeout(nextImport, 200);
        } else if (which === 'detail') {
          closeSheet(el.sheetDetail);
          if (detailUrl) { URL.revokeObjectURL(detailUrl); detailUrl = null; }
          curDetail = null;
          renderLog();
        } else if (which === 'settings') {
          closeSheet(el.sheetSettings);
        } else if (which === 'clients') {
          closeSheet(el.sheetClients);
          clientSavedCb = null;
          resetClientForm();
          el.clientPhoneHint.textContent = '';
        }
      });
    });

    el.saveJob.addEventListener('input', updateSaveButton);
    el.saveNow = null;

    el.saveAddClient.addEventListener('click', function () {
      openClients(
        { name: el.saveJob.value.trim(), phone: (draft && draft.phone) || '' },
        function (client) {
          if (!client) return;
          if (draft) { draft.client = client; draft.phone = util.phoneDigits(client.phone); }
          el.saveJob.value = client.name;
          updateSaveButton();
          if (draft) renderSaveMatch(draft);
        }
      );
    });

    el.clientSave.addEventListener('click', saveClientForm);
    el.clientCancelEdit.addEventListener('click', function () {
      resetClientForm();
      el.clientPhoneHint.textContent = '';
    });
    [el.clientName, el.clientPhone].forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveClientForm(); }
      });
      input.addEventListener('input', function () { el.clientPhoneHint.textContent = ''; });
    });

    el.clientList.addEventListener('click', function (e) {
      var ed = e.target.closest('[data-cedit]');
      if (ed) {
        var c = store.clientById(ed.getAttribute('data-cedit'));
        if (!c) return;
        clientEditId = c.id;
        el.clientName.value = c.name;
        el.clientPhone.value = c.phone || '';
        el.clientSave.textContent = 'Save changes';
        el.clientCancelEdit.hidden = false;
        el.clientName.focus();
        return;
      }
      var del = e.target.closest('[data-cdel]');
      if (del) {
        var c2 = store.clientById(del.getAttribute('data-cdel'));
        if (!c2) return;
        if (!confirm('Remove ' + c2.name + ' from the phone book? Recordings already saved keep their name and number.')) return;
        store.deleteClient(c2.id);
        if (clientEditId === c2.id) resetClientForm();
        renderClients();
        toast('Removed from the phone book');
      }
    });

    document.getElementById('btn-phonebook').addEventListener('click', function () { openClients(); });

    el.chips.addEventListener('click', function (e) {
      var chip = e.target.closest('[data-chip]');
      if (!chip) return;
      el.saveJob.value = chip.getAttribute('data-chip');
      updateSaveButton();
    });

    el.saveConfirm.addEventListener('click', commitSave);

    el.detailExport.addEventListener('click', function () {
      if (!curDetail) return;
      var job = store.jobById(curDetail.jobId);
      util.download(util.textBlob(store.entryText(curDetail)), util.safeFileName('tide-tool-' + util.slug(job ? job.name : 'entry'), 'txt'));
      toast('Exported as text');
    });

    el.detailBody.addEventListener('click', function (e) {
      var rec = curDetail;
      if (!rec) return;

      var chk = e.target.closest('[data-check]');
      if (chk) {
        var id1 = chk.getAttribute('data-check');
        (rec.actionItems || []).forEach(function (t) { if (t.id === id1) t.done = !t.done; });
        store.save();
        renderTasks(rec);
        renderLog();
        return;
      }
      var del = e.target.closest('[data-del]');
      if (del) {
        var id2 = del.getAttribute('data-del');
        rec.actionItems = (rec.actionItems || []).filter(function (t) { return t.id !== id2; });
        store.save();
        renderTasks(rec);
        renderLog();
        return;
      }
      var add = e.target.closest('#d-task-add');
      if (add) { addTask(); return; }

      var ai = e.target.closest('#d-ai');
      if (ai) { runSummary(); return; }

      var asr = e.target.closest('#d-asr');
      if (asr) {
        enqueueTranscription(rec.id);
        toast('Transcribing on this device. First run downloads the model once.');
        return;
      }

      var rm = e.target.closest('#d-delete');
      if (rm) {
        if (!confirm('Delete this recording and its audio from this phone? This cannot be undone.')) return;
        store.deleteRecording(rec.id).then(function () {
          closeSheet(el.sheetDetail);
          if (detailUrl) { URL.revokeObjectURL(detailUrl); detailUrl = null; }
          curDetail = null;
          renderLog();
          toast('Recording deleted');
        });
      }
    });

    el.detailBody.addEventListener('keydown', function (e) {
      if (e.target.id === 'd-task-input' && e.key === 'Enter') {
        e.preventDefault();
        addTask();
      }
    });

    document.getElementById('set-save').addEventListener('click', function () {
      store.setSettings({
        baseUrl: el.setBase.value.trim(),
        apiKey: el.setKey.value.trim(),
        model: el.setModel.value.trim()
      });
      updateAiTag();
      toast(store.aiReady() ? 'AI summary is on' : 'Settings saved — AI summary is off');
    });

    document.getElementById('btn-export-json').addEventListener('click', exportJson);
    document.getElementById('btn-import-json').addEventListener('click', function () { el.importJsonInput.click(); });
    el.importJsonInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) importJsonFile(e.target.files[0]);
      e.target.value = '';
    });

    document.getElementById('btn-clear-all').addEventListener('click', function () {
      if (!confirm('Delete every recording, transcript and note on this device? Export a backup first if you are not sure.')) return;
      store.state.recordings.forEach(function (r) { TT.audioStore.remove(r.id); });
      store.state.recordings = [];
      store.state.jobs = [];
      store.save();
      TT.audioStore.clear();
      renderLog();
      renderStats();
      toast('All recordings deleted from this device');
    });

    // key handling for search
    el.search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { el.search.value = ''; renderLog(); }
    });
  }

  function addTask() {
    var input = document.getElementById('d-task-input');
    if (!input || !curDetail) return;
    var text = input.value.trim();
    if (!text) return;
    curDetail.actionItems = curDetail.actionItems || [];
    curDetail.actionItems.push({ id: util.uid(), text: text, done: false, createdAt: new Date().toISOString() });
    store.save();
    input.value = '';
    renderTasks(curDetail);
    renderLog();
    input.focus();
  }

  function runSummary() {
    var rec = curDetail;
    if (!rec) return;
    if (!rec.transcript || !rec.transcript.trim()) {
      toast('There is no transcript to summarize yet.');
      return;
    }
    if (!store.aiReady()) {
      toast('Add your AI endpoint in Settings first — or keep using the app without it.');
      openSettings();
      return;
    }
    var btn = document.getElementById('d-ai');
    if (btn) { btn.disabled = true; btn.textContent = 'Summarizing…'; }
    var job = store.jobById(rec.jobId);
    TT.AI.summarize({
      jobName: job ? job.name : rec.jobName,
      when: util.stampFull(rec.createdAt),
      transcript: rec.transcript,
      notes: rec.notes
    }).then(function (text) {
      rec.summary = text;
      store.save();
      renderSummary(rec);
      toast('Summary saved');
    }).catch(function (err) {
      toast(err.message || 'Summary failed');
    }).then(function () {
      var b = document.getElementById('d-ai');
      if (b) { b.disabled = false; b.innerHTML = ICON.spark + 'Summarize'; }
    });
  }

  TT.UI = {
    init: function () {
      cacheEls();
      buildMeter();
      bind();
      renderLog();
      levelToBars(0);
    },
    renderLog: renderLog,
    toast: toast,
    openRecorder: openRecorder
  };
})();

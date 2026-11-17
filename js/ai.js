/* ============================================================
   ai.js — optional summary through an OpenAI-compatible endpoint.
   Only runs when the user taps "Summarize" with settings filled in.
   Nothing is sent at any other time.
   ============================================================ */
(function () {
  'use strict';

  var TT = (window.TT = window.TT || {});

  var SYSTEM = [
    'You are helping a one-man handyman business in Hawaii turn a voice note from a job site into something he can act on.',
    'Summarize ONLY what is in the text. Never invent prices, dates or promises.',
    'Answer with plain text (no markdown symbols, no bullet characters other than "-").',
    'Use exactly these three headings, each on its own line:',
    'KEY POINTS',
    'PRICES & DATES',
    'ACTION ITEMS',
    'Under each heading use short "- " lines. If the text does not mention prices, dates or action items, write "- not mentioned".',
    'Keep the whole answer under 140 words.'
  ].join(' ');

  function buildUser(jobName, when, transcript, notes) {
    var parts = [];
    parts.push('Client / job: ' + (jobName || 'unknown'));
    parts.push('When: ' + (when || 'unknown'));
    parts.push('');
    parts.push('Transcript:');
    parts.push(transcript || '(no transcript)');
    if (notes && notes.trim()) {
      parts.push('');
      parts.push('Notes I typed myself:');
      parts.push(notes.trim());
    }
    return parts.join('\n');
  }

  function summarize(opts) {
    var s = TT.store.state.settings;
    if (!s.baseUrl || !s.apiKey || !s.model) {
      return Promise.reject(new Error('AI summary is not set up. Add a base URL, key and model in Settings.'));
    }
    var base = s.baseUrl.trim().replace(/\/+$/, '');
    var url = /\/chat\/completions$/.test(base) ? base : base + '/chat/completions';

    var body = {
      model: s.model.trim(),
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUser(opts.jobName, opts.when, opts.transcript, opts.notes) }
      ],
      temperature: 0.2,
      max_tokens: 400
    };

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 60000);

    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.apiKey.trim()
      },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (text) {
        if (!res.ok) {
          var detail = '';
          try {
            var j = JSON.parse(text);
            detail = (j.error && (j.error.message || j.error)) || '';
          } catch (e) { detail = String(text).slice(0, 200); }
          if (res.status === 401 || res.status === 403) {
            throw new Error('The endpoint rejected the API key (HTTP ' + res.status + '). Check Settings.');
          }
          if (res.status === 404) {
            throw new Error('Endpoint not found (404). The base URL probably needs to end in /v1.');
          }
          throw new Error('The endpoint returned HTTP ' + res.status + (detail ? ' — ' + detail : ''));
        }
        var data;
        try { data = JSON.parse(text); } catch (e) {
          throw new Error('The endpoint did not return JSON. Check the base URL.');
        }
        var content = data && data.choices && data.choices[0] &&
          (data.choices[0].message ? data.choices[0].message.content : data.choices[0].text);
        if (!content) throw new Error('The endpoint returned an empty summary.');
        if (Array.isArray(content)) content = content.map(function (c) { return c.text || ''; }).join(' ');
        return String(content).trim();
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw new Error('The summary request timed out after 60 seconds.');
      }
      if (err && err.message === 'Failed to fetch') {
        throw new Error('Could not reach that endpoint. Check the base URL, your connection, or whether the provider allows browser (CORS) requests.');
      }
      throw err;
    });
  }

  TT.AI = { summarize: summarize, systemPrompt: SYSTEM };
})();

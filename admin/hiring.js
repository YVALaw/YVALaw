/*
 * "Open & close roles" board (/admin/hiring.html).
 * Lists every job post (jobs/*.md) with an Open/Closed switch and saves all changed
 * roles in a single commit, so the Careers page rebuilds once.
 * Talks to GitHub through Netlify's Git Gateway with the content manager's login
 * (Netlify Identity), using the same API calls Decap CMS makes: read the branch,
 * list the folder, read blobs, then blobs -> tree -> commit -> move the branch.
 * Only the `status:` line of each changed file is rewritten; the rest of the file is
 * kept exactly as it is on GitHub at the moment of saving.
 */
(function () {
  var GATEWAY = '/.netlify/git/github';
  var BRANCH = 'main'; // keep in step with backend.branch in admin/config.yml
  var FOLDER = 'jobs';

  var jobs = []; // { file, title, status, saved }
  var busy = false;

  var $ = function (id) { return document.getElementById(id); };

  function showMessage(text, kind) {
    var box = $('message');
    box.textContent = text;
    box.className = 'mb-6 rounded-2xl px-5 py-4 text-sm font-bold ' + (kind === 'error'
      ? 'bg-red-50 text-red-700 border border-red-200'
      : 'bg-emerald-50 text-emerald-800 border border-emerald-200');
    box.classList.remove('hidden');
  }

  function hideMessage() { $('message').classList.add('hidden'); }

  // ---- Git Gateway ----------------------------------------------------------

  function api(method, path, body) {
    var identity = window.netlifyIdentity;
    var user = identity && identity.currentUser();
    if (!user) return Promise.reject(new Error('LOGIN'));
    return user.jwt().then(function (token) {
      return fetch(GATEWAY + path, {
        method: method,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json; charset=utf-8' },
        body: body ? JSON.stringify(body) : undefined
      });
    }).then(function (res) {
      if (res.ok) return res.json();
      return res.text().then(function (text) {
        var error = new Error(text || res.statusText);
        error.status = res.status;
        throw error;
      });
    });
  }

  function decodeBase64(b64) {
    var bytes = Uint8Array.from(atob(String(b64).replace(/\s/g, '')), function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64(text) {
    var binary = '';
    new TextEncoder().encode(text).forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  // ---- Frontmatter ------------------------------------------------------------

  function frontmatter(text) {
    var match = text.match(/^---\r?\n[\s\S]*?\r?\n---/);
    return match ? match[0] : '';
  }

  function readValue(text, key) {
    var match = frontmatter(text).match(new RegExp('^' + key + ':[ \\t]*(.*)$', 'm'));
    return match ? match[1].trim().replace(/^(["'])(.*)\1$/, '$2') : '';
  }

  function isOpen(status) { return String(status || 'Open').toLowerCase() === 'open'; }

  function withStatus(text, status) {
    var fm = frontmatter(text);
    if (!fm) throw new Error('This job file has no settings block');
    var updated = /^status:.*$/m.test(fm)
      ? fm.replace(/^status:.*$/m, 'status: ' + status)
      : fm.replace(/^---(\r?\n)/, '---$1status: ' + status + '$1');
    return updated + text.slice(fm.length);
  }

  // ---- Load -------------------------------------------------------------------

  function load() {
    $('login').classList.add('hidden');
    $('loading').classList.remove('hidden');
    $('jobs').innerHTML = '';
    return api('GET', '/git/trees/' + BRANCH + ':' + FOLDER).then(function (listing) {
      var files = listing.tree.filter(function (item) { return item.type === 'blob' && /\.md$/.test(item.path); });
      return Promise.all(files.map(function (item) {
        return api('GET', '/git/blobs/' + item.sha).then(function (blob) {
          var text = decodeBase64(blob.content);
          var status = isOpen(readValue(text, 'status')) ? 'Open' : 'Closed';
          return { file: item.path, title: readValue(text, 'title') || item.path.replace(/\.md$/, ''), status: status, saved: status };
        });
      }));
    }).then(function (list) {
      jobs = list.sort(function (a, b) { return a.title.localeCompare(b.title); });
      $('loading').classList.add('hidden');
      render();
    }).catch(handleError);
  }

  // ---- Render -----------------------------------------------------------------

  function render() {
    var listEl = $('jobs');
    listEl.innerHTML = '';
    if (!jobs.length) {
      var empty = document.createElement('li');
      empty.className = 'text-slate-500 font-bold';
      empty.textContent = 'No job posts yet. Add one in Job Posts.';
      listEl.appendChild(empty);
    }
    jobs.forEach(function (job) {
      var changed = job.status !== job.saved;
      var row = document.createElement('li');
      row.className = changed
        ? 'bg-white rounded-2xl border-2 border-yellow-400 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3'
        : 'bg-white rounded-2xl border-2 border-slate-100 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3';

      var info = document.createElement('div');
      var title = document.createElement('p');
      title.className = 'font-black text-[#1b1e2b]';
      title.textContent = job.title;
      info.appendChild(title);
      if (changed) {
        var note = document.createElement('p');
        note.className = 'text-xs font-bold text-amber-600 mt-1';
        note.textContent = 'Was ' + job.saved + ' · not saved yet';
        info.appendChild(note);
      }

      var group = document.createElement('div');
      group.className = 'inline-flex self-start sm:self-auto rounded-xl bg-slate-100 p-1';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', 'Status of ' + job.title);
      ['Open', 'Closed'].forEach(function (status) {
        var active = job.status === status;
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = status;
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
        button.disabled = busy;
        button.className = active
          ? (status === 'Open'
            ? 'px-5 py-2 rounded-lg text-sm font-black bg-emerald-500 text-white shadow-sm'
            : 'px-5 py-2 rounded-lg text-sm font-black bg-[#1b1e2b] text-white shadow-sm')
          : 'px-5 py-2 rounded-lg text-sm font-black text-slate-500 hover:text-[#1b1e2b] transition-colors';
        button.addEventListener('click', function () {
          if (busy || job.status === status) return;
          job.status = status;
          hideMessage();
          render();
        });
        group.appendChild(button);
      });

      row.appendChild(info);
      row.appendChild(group);
      listEl.appendChild(row);
    });

    var count = jobs.filter(function (job) { return job.status !== job.saved; }).length;
    $('save-bar').classList.toggle('hidden', count === 0);
    $('change-count').textContent = count === 1 ? '1 change not saved' : count + ' changes not saved';
    $('save-button').disabled = busy;
    $('save-button').textContent = busy ? 'Saving…' : 'Save changes';
    $('undo-button').disabled = busy;
  }

  // ---- Save -------------------------------------------------------------------

  function save() {
    var changed = jobs.filter(function (job) { return job.status !== job.saved; });
    if (!changed.length || busy) return;
    busy = true;
    hideMessage();
    render();

    var user = window.netlifyIdentity.currentUser();
    var meta = (user && user.user_metadata) || {};
    var headSha;
    var baseTree;

    api('GET', '/branches/' + BRANCH).then(function (branch) {
      headSha = branch.commit.sha;
      baseTree = branch.commit.commit.tree.sha;
      // Re-read the files as they are now, so edits saved since this page loaded are kept.
      return api('GET', '/git/trees/' + BRANCH + ':' + FOLDER);
    }).then(function (listing) {
      return Promise.all(changed.map(function (job) {
        var item = listing.tree.find(function (entry) { return entry.path === job.file; });
        if (!item) throw new Error('“' + job.title + '” was renamed or deleted since this page loaded. Reload the page and try again.');
        return api('GET', '/git/blobs/' + item.sha).then(function (blob) {
          return api('POST', '/git/blobs', { content: encodeBase64(withStatus(decodeBase64(blob.content), job.status)), encoding: 'base64' });
        }).then(function (created) {
          return { path: FOLDER + '/' + job.file, mode: '100644', type: 'blob', sha: created.sha };
        });
      }));
    }).then(function (entries) {
      return api('POST', '/git/trees', { base_tree: baseTree, tree: entries });
    }).then(function (tree) {
      var commit = {
        message: 'Job openings: ' + changed.map(function (job) { return job.title + ' → ' + job.status; }).join(', '),
        tree: tree.sha,
        parents: [headSha]
      };
      if (user && user.email) {
        commit.author = { name: meta.full_name || user.email.split('@')[0], email: user.email, date: new Date().toISOString() };
      }
      return api('POST', '/git/commits', commit);
    }).then(function (commit) {
      // Not forced: fails instead of overwriting if someone else saved in the meantime.
      return api('PATCH', '/git/refs/heads/' + BRANCH, { sha: commit.sha, force: false });
    }).then(function () {
      changed.forEach(function (job) { job.saved = job.status; });
      busy = false;
      render();
      showMessage('Saved. The Careers page will show the change in about a minute.', 'success');
    }).catch(function (error) {
      busy = false;
      render();
      handleError(error);
    });
  }

  function handleError(error) {
    $('loading').classList.add('hidden');
    if (error && (error.message === 'LOGIN' || error.status === 401)) {
      $('login').classList.remove('hidden');
      if (error.status === 401) showMessage('Your login has expired. Log in again, then save.', 'error');
      return;
    }
    var text = error && error.status === 422
      ? 'Someone else saved a change at the same moment. Reload the page and try again.'
      : 'Something went wrong: ' + ((error && error.message) || 'unknown error') + '. Nothing was changed. Try again, or switch the role in Job Posts instead.';
    showMessage(text, 'error');
    console.error(error);
  }

  // ---- Start ------------------------------------------------------------------

  $('save-button').addEventListener('click', save);
  $('undo-button').addEventListener('click', function () {
    jobs.forEach(function (job) { job.status = job.saved; });
    hideMessage();
    render();
  });
  $('login-button').addEventListener('click', function () { window.netlifyIdentity.open('login'); });
  window.addEventListener('beforeunload', function (event) {
    if (jobs.some(function (job) { return job.status !== job.saved; })) { event.preventDefault(); event.returnValue = ''; }
  });

  var identity = window.netlifyIdentity;
  if (!identity) {
    $('loading').classList.add('hidden');
    showMessage('The login service did not load. Check your connection and reload the page.', 'error');
    return;
  }
  identity.on('init', function (user) {
    if (user) load();
    else { $('loading').classList.add('hidden'); $('login').classList.remove('hidden'); }
  });
  identity.on('login', function () { identity.close(); load(); });
  identity.on('logout', function () { jobs = []; render(); $('login').classList.remove('hidden'); });
})();

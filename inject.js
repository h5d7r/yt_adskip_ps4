(function(){
  if (window.__MH_SPONSORBLOCK_LOADED) { return; }
  window.__MH_SPONSORBLOCK_LOADED = true;

  // ── Toast helper (unchanged) ──────────────────────────────────────
  function showToast(title, subtitle) {
    try {
      var popupAction = {
        openPopupAction: {
          popupType: 'TOAST',
          popup: {
            overlayToastRenderer: {
              title: { simpleText: title },
              subtitle: { simpleText: subtitle }
            }
          }
        }
      };
      for (var key in window._yttv) {
        if (window._yttv[key] && window._yttv[key].instance && window._yttv[key].instance.resolveCommand) {
          window._yttv[key].instance.resolveCommand(popupAction);
          break;
        }
      }
    } catch(e) {}
  }

  // ── 1. JSON.parse monkey-patch (from TizenTube) ──────────────────
  // Intercept YouTube API responses and strip ad data before rendering.
  // Uses delete (not empty array) so downstream truthiness checks work.
  var origParse = JSON.parse;
  JSON.parse = function() {
    var r = origParse.apply(this, arguments);
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      if (r.adPlacements) { delete r.adPlacements; }
      if (r.playerAds)    { delete r.playerAds; }
      if (r.adSlots)      { delete r.adSlots; }
    }
    return r;
  };

  // Patch across all YouTube TV internal contexts (once, like TizenTube)
  window.JSON.parse = JSON.parse;
  try {
    for (var key in window._yttv) {
      if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
        window._yttv[key].JSON.parse = JSON.parse;
      }
    }
  } catch(e) {}

  // ── 2. SponsorBlock — event-driven segment skipping ──────────────
  var sponsorSegments = [];
  var currentVideoId = null;
  var currentVideo = null;
  var skipTimeout = null;
  var skippedMap = {};  // UUID -> { count, firstSkipped, lastSkipped }

  function getVideoId() {
    try {
      var match = window.location.hash.match(/[?&]v=([^&]+)/);
      return match ? match[1] : null;
    } catch(e) {
      return null;
    }
  }

  function loadSponsorBlock(videoId) {
    if (!videoId) return;
    var tryPort = function(port) {
      try {
        var xhr = new XMLHttpRequest();
        var url = 'http://127.0.0.1:' + port + '/' + encodeURIComponent(videoId);
        xhr.timeout = 2000;
        xhr.onload = function() {
          if (xhr.status === 200) {
            try {
              var data = origParse(xhr.responseText);
              if (Array.isArray(data) && data.length > 0) {
                sponsorSegments = data;
                showToast('SponsorBlock', data.length + ' segment(s) found');
                // Kick off event-driven skipping now that segments are loaded
                scheduleSkip();
              } else {
                sponsorSegments = [];
              }
            } catch(e) {}
          }
        };
        xhr.onerror = function() { if (port < 4050) tryPort(port + 1); };
        xhr.ontimeout = function() { if (port < 4050) tryPort(port + 1); };
        xhr.open('GET', url, true);
        xhr.send();
      } catch(e) {
        if (port < 4050) tryPort(port + 1);
      }
    };
    tryPort(4040);
  }

  // Event-driven skip scheduling (adapted from TizenTube)
  function scheduleSkip() {
    if (skipTimeout) {
      clearTimeout(skipTimeout);
      skipTimeout = null;
    }

    if (!currentVideo || currentVideo.paused || sponsorSegments.length === 0) return;

    var now = currentVideo.currentTime;

    // Find the next segment that hasn't been fully passed yet
    var nextSegments = [];
    for (var i = 0; i < sponsorSegments.length; i++) {
      var seg = sponsorSegments[i].segment;
      if (seg[0] > now - 0.3 && seg[1] > now - 0.3) {
        nextSegments.push(sponsorSegments[i]);
      }
    }
    nextSegments.sort(function(a, b) { return a.segment[0] - b.segment[0]; });

    if (nextSegments.length === 0) return;

    var segment = nextSegments[0];
    var start = segment.segment[0];
    var end = segment.segment[1];
    var delay = (start - now) * 1000;

    skipTimeout = setTimeout(function() {
      if (!currentVideo || currentVideo.paused) return;

      // Infinite-loop protection (from TizenTube): if we've skipped
      // the same segment multiple times within 1 second, stop.
      var uuid = segment.UUID || (segment.category + '_' + start + '_' + end);
      var prev = skippedMap[uuid];
      if (prev) {
        prev.count++;
        prev.lastSkipped = Date.now();
        if (prev.lastSkipped - prev.firstSkipped < 1000) {
          return; // likely an infinite skip loop, bail out
        }
      } else {
        skippedMap[uuid] = { count: 1, firstSkipped: Date.now(), lastSkipped: Date.now() };
      }

      var skipName = segment.category;
      showToast('Segment Skipped', skipName + ' (' + Math.floor(end - start) + 's)');

      // Avoid seeking to the very end of the video
      if (currentVideo.duration - end < 1) {
        currentVideo.currentTime = end - 1;
      } else {
        currentVideo.currentTime = end;
      }

      // Schedule the next segment
      scheduleSkip();
    }, Math.max(delay, 0));
  }

  function onScheduleSkip() {
    scheduleSkip();
  }

  // ── 3. Video attachment & cleanup ─────────────────────────────────
  function detachVideo() {
    if (currentVideo) {
      currentVideo.removeEventListener('play', onScheduleSkip);
      currentVideo.removeEventListener('pause', onScheduleSkip);
      currentVideo.removeEventListener('timeupdate', onScheduleSkip);
      currentVideo = null;
    }
    if (skipTimeout) {
      clearTimeout(skipTimeout);
      skipTimeout = null;
    }
  }

  function attachVideo() {
    detachVideo();
    var video = document.querySelector('video');
    if (!video) {
      setTimeout(attachVideo, 200);
      return;
    }
    currentVideo = video;
    currentVideo.addEventListener('play', onScheduleSkip);
    currentVideo.addEventListener('pause', onScheduleSkip);
    currentVideo.addEventListener('timeupdate', onScheduleSkip);
  }

  // ── 4. Video change detection via hashchange event ────────────────
  function onVideoChange() {
    var videoId = getVideoId();
    if (videoId && videoId !== currentVideoId) {
      currentVideoId = videoId;
      sponsorSegments = [];
      skippedMap = {};
      attachVideo();
      loadSponsorBlock(videoId);
    }
  }

  window.addEventListener('hashchange', onVideoChange, false);

  // Initial check
  onVideoChange();

  setTimeout(function() {
    showToast('Ad Block + SponsorBlock Enabled!', 'by earthonion');
  }, 2000);

  (function() {
    var _ryd_last = '';

    // Find the dislike button container and inject count below it
    // YouTube TV uses ytm-button-renderer or similar elements
    function findDislikeContainer() {
      // Try multiple selectors used in YouTube TV / Cobalt
      var selectors = [
        'ytm-toggle-button-renderer:nth-of-type(2)',
        'ytm-button-renderer:nth-of-type(2)',
        '[aria-label*="islike"]:nth-of-type(2)',
        '[aria-label*="Don"]',
        'button:nth-of-type(2)'
      ];
      var buttons = document.querySelectorAll('ytm-toggle-button-renderer, ytm-button-renderer, .yt-icon-button');
      // The dislike button is typically the second button in the action bar
      if (buttons && buttons.length >= 2) return buttons[1];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (el) return el;
      }
      return null;
    }

    function injectDislikeUI(dislikes_s) {
      var existing = document.getElementById('_ryd_dislike_label');
      if (existing) {
        existing.textContent = dislikes_s;
        return;
      }

      var tryInject = function(attempt) {
        var container = findDislikeContainer();
        if (!container) {
          if (attempt < 15) setTimeout(function(){ tryInject(attempt + 1); }, 400);
          return;
        }
        // Check if parent has a label below it (like the like button)
        var parent = container.parentElement || container;
        var label = document.createElement('div');
        label.id = '_ryd_dislike_label';
        // Match YouTube TV's like count style as closely as possible
        label.style.cssText = 'color:#fff;font-size:0.75em;text-align:center;margin-top:2px;' +
          'font-family:inherit;pointer-events:none;white-space:nowrap;';
        label.textContent = dislikes_s;
        // Insert after the container, same level as how like count appears
        if (parent.nextSibling) {
          parent.parentNode.insertBefore(label, parent.nextSibling);
        } else {
          parent.parentNode.appendChild(label);
        }
      };
      tryInject(0);
    }

    function fetchRYD(videoId) {
      if (!videoId || videoId === _ryd_last) return;
      _ryd_last = videoId;
      var el = document.getElementById('_ryd_dislike_label');
      if (el) el.remove();
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'http://127.0.0.1:4040/ryd?videoId=' + videoId, true);
        xhr.timeout = 3000;
        xhr.onload = function() {
          try {
            var d = origParse(xhr.responseText);
            if (d.d !== undefined) injectDislikeUI(d.d);
          } catch(e) {}
        };
        xhr.send();
      } catch(e) {}
    }

    var _origOnVideoChange = onVideoChange;
    onVideoChange = function() {
      _origOnVideoChange();
      fetchRYD(getVideoId());
    };

    window.addEventListener('hashchange', function() {
      fetchRYD(getVideoId());
    }, false);

    fetchRYD(getVideoId());
  })();
})();

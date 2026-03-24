(function(){
  if (window.__MH_SPONSORBLOCK_LOADED) { return; }
  window.__MH_SPONSORBLOCK_LOADED = true;

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

  window.JSON.parse = JSON.parse;
  try {
    for (var key in window._yttv) {
      if (window._yttv[key] && window._yttv[key].JSON && window._yttv[key].JSON.parse) {
        window._yttv[key].JSON.parse = JSON.parse;
      }
    }
  } catch(e) {}

  var sponsorSegments = [];
  var currentVideoId = null;
  var currentVideo = null;
  var skipTimeout = null;
  var skippedMap = {};
  var dislikeCache = {};
  var dislikePending = {};
  var dislikeNode = null;
  var dislikeObserver = null;
  var dislikeRenderTimer = null;

  function getVideoId() {
    try {
      var href = String(window.location.href || '');
      var hash = String(window.location.hash || '');
      var match = href.match(/[?&]v=([^&]+)/) || hash.match(/[?&]v=([^&]+)/);
      return match ? decodeURIComponent(match[1]) : null;
    } catch(e) {
      return null;
    }
  }

  function formatCount(n) {
    if (typeof n !== 'number' || isNaN(n)) return '';
    if (n < 1000) return String(n);
    if (n < 1000000) {
      var k = n / 1000;
      return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'K';
    }
    var m = n / 1000000;
    return (m >= 100 ? Math.round(m) : Math.round(m * 10) / 10) + 'M';
  }

  function findLikeButton() {
    var nodes = document.querySelectorAll('button, [role="button"], ytlr-like-button-renderer, ytlr-toggle-button-renderer');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var label = '';
      try {
        label = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').toLowerCase();
      } catch(e) {}
      if (label.indexOf('like') !== -1 && label.indexOf('dislike') === -1) {
        return node;
      }
    }
    return null;
  }

  function renderDislikeCount(videoId) {
    if (!videoId || !dislikeCache.hasOwnProperty(videoId)) return;

    var likeButton = findLikeButton();
    if (!likeButton || !likeButton.parentNode) return;

    if (!dislikeNode || !dislikeNode.parentNode) {
      dislikeNode = document.createElement('span');
      dislikeNode.className = 'mh-dislike-count';
      dislikeNode.style.display = 'inline-block';
      dislikeNode.style.pointerEvents = 'none';
      dislikeNode.style.whiteSpace = 'nowrap';
      dislikeNode.style.verticalAlign = 'middle';
      dislikeNode.style.marginLeft = '14px';
    }

    try {
      var s = window.getComputedStyle(likeButton);
      dislikeNode.style.color = s.color;
      dislikeNode.style.fontFamily = s.fontFamily;
      dislikeNode.style.fontSize = s.fontSize;
      dislikeNode.style.fontWeight = s.fontWeight;
      dislikeNode.style.lineHeight = s.lineHeight;
      dislikeNode.style.letterSpacing = s.letterSpacing;
      dislikeNode.style.opacity = s.opacity || '1';
    } catch(e) {}

    dislikeNode.textContent = 'Dislike ' + formatCount(dislikeCache[videoId]);

    if (likeButton.nextSibling !== dislikeNode) {
      likeButton.parentNode.insertBefore(dislikeNode, likeButton.nextSibling);
    }
  }

  function queueDislikeRender() {
    if (dislikeRenderTimer) return;
    dislikeRenderTimer = setTimeout(function() {
      dislikeRenderTimer = null;
      if (currentVideoId) {
        renderDislikeCount(currentVideoId);
      }
    }, 150);
  }

  function watchDislikeUi() {
    if (dislikeObserver || !window.MutationObserver) return;
    dislikeObserver = new MutationObserver(function() {
      queueDislikeRender();
    });
    dislikeObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
  }

  function loadDislikeCount(videoId) {
    if (!videoId) return;
    if (dislikeCache.hasOwnProperty(videoId)) {
      queueDislikeRender();
      return;
    }
    if (dislikePending[videoId]) return;

    dislikePending[videoId] = true;

    try {
      var xhr = new XMLHttpRequest();
      xhr.timeout = 4000;
      xhr.onload = function() {
        delete dislikePending[videoId];
        if (xhr.status !== 200) return;
        try {
          var data = origParse(xhr.responseText);
          dislikeCache[videoId] = data && typeof data.dislikes === 'number' ? data.dislikes : 0;
          queueDislikeRender();
        } catch(e) {}
      };
      xhr.onerror = function() { delete dislikePending[videoId]; };
      xhr.ontimeout = function() { delete dislikePending[videoId]; };
      xhr.open('GET', 'https://returnyoutubedislikeapi.com/votes?videoId=' + encodeURIComponent(videoId), true);
      xhr.send();
    } catch(e) {
      delete dislikePending[videoId];
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

  function scheduleSkip() {
    if (skipTimeout) {
      clearTimeout(skipTimeout);
      skipTimeout = null;
    }
    if (!currentVideo || currentVideo.paused || sponsorSegments.length === 0) return;
    var now = currentVideo.currentTime;
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
      var uuid = segment.UUID || (segment.category + '_' + start + '_' + end);
      var prev = skippedMap[uuid];
      if (prev) {
        prev.count++;
        prev.lastSkipped = Date.now();
        if (prev.lastSkipped - prev.firstSkipped < 1000) {
          return;
        }
      } else {
        skippedMap[uuid] = { count: 1, firstSkipped: Date.now(), lastSkipped: Date.now() };
      }
      showToast('Segment Skipped', segment.category + ' (' + Math.floor(end - start) + 's)');
      if (currentVideo.duration - end < 1) {
        currentVideo.currentTime = end - 1;
      } else {
        currentVideo.currentTime = end;
      }
      scheduleSkip();
    }, Math.max(delay, 0));
  }

  function onScheduleSkip() { scheduleSkip(); }

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

  function onVideoChange() {
    var videoId = getVideoId();
    if (videoId && videoId !== currentVideoId) {
      currentVideoId = videoId;
      sponsorSegments = [];
      skippedMap = {};
      if (dislikeNode && dislikeNode.parentNode) {
        dislikeNode.parentNode.removeChild(dislikeNode);
      }
      dislikeNode = null;
      attachVideo();
      loadSponsorBlock(videoId);
      loadDislikeCount(videoId);
      queueDislikeRender();
    }
  }

  watchDislikeUi();
  window.addEventListener('hashchange', onVideoChange, false);
  onVideoChange();

  setTimeout(function() {
    showToast('Ad Block + SponsorBlock Enabled!', 'by earthonion');
  }, 2000);
})();

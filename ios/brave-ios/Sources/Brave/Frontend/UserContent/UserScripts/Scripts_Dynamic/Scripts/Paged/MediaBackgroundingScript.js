// Copyright (c) 2021 The Brave Authors. All rights reserved.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

// The below is needed because the script may not be web-packed into a bundle so it may be missing the run-once code

window.__firefox__.includeOnce("MediaBackgrounding", function($) {
  if (window.braveMediaBackgroundingEnabled) {
    return;
  }
  window.braveMediaBackgroundingEnabled = true;

  const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  const visibilityStateGet = descriptor && descriptor.get;
  if (descriptor && visibilityStateGet) {
    Object.defineProperty(Document.prototype, "visibilityState", {
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
      get: $(function() {
        const result = visibilityStateGet.call(this);
        if (result != "visible") {
          return "visible";
        }
        return result;
      })
    });
  }

  const mediaStates = new WeakMap();
  const listeningMediaElements = new WeakSet();
  const observedRoots = new WeakSet();
  const backgroundTransitionWindowMs = 2000;
  const userInteractionWindowMs = 1000;
  let lastHiddenTransitionTime = 0;

  function realVisibilityState() {
    return visibilityStateGet ? visibilityStateGet.call(document) : document.visibilityState;
  }

  function stateFor(element) {
    let state = mediaStates.get(element);
    if (!state) {
      state = {
        lastUserInteractionTime: 0,
        presentationModeListener: false,
        userHitPause: false
      };
      mediaStates.set(element, state);
    }
    return state;
  }

  function isInBackgroundTransition() {
    return Date.now() - lastHiddenTransitionTime <= backgroundTransitionWindowMs;
  }

  function maybePlay(element) {
    if (element.ended || !element.paused) {
      return;
    }

    playControl.call(element).catch(function() {});
  }

  document.addEventListener("visibilitychange", $(function() {
    if (realVisibilityState() != "visible") {
      lastHiddenTransitionTime = Date.now();
    }
  }), false);

  const pauseControl = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = $(function() {
    const state = stateFor(this);
    state.userHitPause = realVisibilityState() == "visible"
      && Date.now() - state.lastUserInteractionTime <= userInteractionWindowMs;
    pauseControl.call(this);
  });

  const playControl = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = $(function() {
    stateFor(this).userHitPause = false;
    return playControl.call(this);
  });

  function addListeners(element) {
    if (!listeningMediaElements.has(element)) {
      listeningMediaElements.add(element);
      const state = stateFor(element);
      const recordUserInteraction = $(function() {
        state.lastUserInteractionTime = Date.now();
      });

      element.addEventListener("pointerdown", recordUserInteraction, true);
      element.addEventListener("touchstart", recordUserInteraction, true);
      element.addEventListener("keydown", recordUserInteraction, true);

      element.addEventListener("pause", $(function() {
        const isBackgroundPause = realVisibilityState() != "visible" || isInBackgroundTransition();
        if (!state.userHitPause && isBackgroundPause) {
          maybePlay(element);
        }
      }), false);
    }

    const state = stateFor(element);
    if (element instanceof HTMLVideoElement && !state.presentationModeListener) {
      state.presentationModeListener = true;

      element.addEventListener("webkitpresentationmodechanged", $(function(e) {
        e.stopPropagation();
      }), true);
    }
  }

  const queue = [];
  function addMediaElements(root) {
    root.querySelectorAll("audio, video").forEach(function(element) {
      addListeners(element);
    });
  }

  function observeRoot(root) {
    if (observedRoots.has(root)) {
      return;
    }
    observedRoots.add(root);
    addMediaElements(root);
    observer.observe(root, {
      childList: true,
      attributes: false,
      characterData: false,
      subtree: true,
      attributeOldValue: false,
      characterDataOldValue: false
    });
  }

  function scanNode(node) {
    if (node instanceof HTMLMediaElement) {
      addListeners(node);
    }
    if (node instanceof Element) {
      addMediaElements(node);
      if (node.shadowRoot) {
        observeRoot(node.shadowRoot);
      }
    }
  }

  function onMutation() {
    for (const mutation of queue) {
      mutation.addedNodes.forEach(scanNode);
    }
    queue.length = 0;
  }

  const observer = new MutationObserver($(function(mutations) {
    if (!queue.length) {
      requestAnimationFrame(onMutation);
    }
    queue.push(...mutations);
  }));

  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = $(function(init) {
    const shadowRoot = attachShadow.call(this, init);
    observeRoot(shadowRoot);
    return shadowRoot;
  });

  observeRoot(document);
});

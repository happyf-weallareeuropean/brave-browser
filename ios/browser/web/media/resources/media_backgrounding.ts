// Copyright (c) 2026 The Brave Authors. All rights reserved.
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this file,
// You can obtain one at https://mozilla.org/MPL/2.0/.

function enable(): void {
  const windowWithState = window as any
  if (windowWithState.braveMediaBackgroundingEnabled) {
    return
  }
  windowWithState.braveMediaBackgroundingEnabled = true

  const descriptor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'visibilityState',
  )
  const visibilityStateGet = descriptor?.get

  if (descriptor && visibilityStateGet) {
    Object.defineProperty(Document.prototype, 'visibilityState', {
      enumerable: descriptor.enumerable,
      configurable: descriptor.configurable,
      get() {
        const result = visibilityStateGet.call(this)
        if (result !== 'visible') {
          return 'visible'
        }
        return result
      },
    })
  }

  type MediaState = {
    lastUserInteractionTime: number
    presentationModeListener: boolean
    userHitPause: boolean
  }

  const mediaStates = new WeakMap<HTMLMediaElement, MediaState>()
  const listeningMediaElements = new WeakSet<HTMLMediaElement>()
  const observedRoots = new WeakSet<Document | ShadowRoot>()
  const backgroundTransitionWindowMs = 2000
  const userInteractionWindowMs = 1000
  let lastHiddenTransitionTime = 0

  function realVisibilityState(): DocumentVisibilityState {
    return visibilityStateGet?.call(document) ?? document.visibilityState
  }

  function stateFor(element: HTMLMediaElement): MediaState {
    let state = mediaStates.get(element)
    if (!state) {
      state = {
        lastUserInteractionTime: 0,
        presentationModeListener: false,
        userHitPause: false,
      }
      mediaStates.set(element, state)
    }
    return state
  }

  function isInBackgroundTransition(): boolean {
    return Date.now() - lastHiddenTransitionTime <= backgroundTransitionWindowMs
  }

  function maybePlay(element: HTMLMediaElement): void {
    if (element.ended || !element.paused) {
      return
    }

    void playControl.call(element).catch(() => {})
  }

  document.addEventListener(
    'visibilitychange',
    function () {
      if (realVisibilityState() !== 'visible') {
        lastHiddenTransitionTime = Date.now()
      }
    },
    false,
  )

  const pauseControl = HTMLMediaElement.prototype.pause
  HTMLMediaElement.prototype.pause = function (): void {
    const state = stateFor(this)
    state.userHitPause =
      realVisibilityState() === 'visible' &&
      Date.now() - state.lastUserInteractionTime <= userInteractionWindowMs
    pauseControl.call(this)
  }

  const playControl = HTMLMediaElement.prototype.play
  HTMLMediaElement.prototype.play = function (): Promise<void> {
    stateFor(this).userHitPause = false
    return playControl.call(this)
  }

  function addListeners(element: HTMLMediaElement): void {
    if (!listeningMediaElements.has(element)) {
      listeningMediaElements.add(element)
      const state = stateFor(element)
      const recordUserInteraction = () => {
        state.lastUserInteractionTime = Date.now()
      }

      element.addEventListener('pointerdown', recordUserInteraction, true)
      element.addEventListener('touchstart', recordUserInteraction, true)
      element.addEventListener('keydown', recordUserInteraction, true)

      element.addEventListener(
        'pause',
        function () {
          const isBackgroundPause =
            realVisibilityState() !== 'visible' || isInBackgroundTransition()
          if (!state.userHitPause && isBackgroundPause) {
            maybePlay(element)
          }
        },
        false,
      )
    }

    const state = stateFor(element)
    if (element instanceof HTMLVideoElement && !state.presentationModeListener) {
      state.presentationModeListener = true
      element.addEventListener(
        'webkitpresentationmodechanged',
        function (e) {
          e.stopPropagation()
        },
        true,
      )
    }
  }

  const queue: MutationRecord[] = []
  function addMediaElements(root: ParentNode): void {
    root
      .querySelectorAll('audio, video')
      .forEach((element) => addListeners(element as HTMLMediaElement))
  }

  function observeRoot(root: Document | ShadowRoot): void {
    if (observedRoots.has(root)) {
      return
    }
    observedRoots.add(root)
    addMediaElements(root)
    observer.observe(root, {
      childList: true,
      attributes: false,
      characterData: false,
      subtree: true,
      attributeOldValue: false,
      characterDataOldValue: false,
    })
  }

  function scanNode(node: Node): void {
    if (node instanceof HTMLMediaElement) {
      addListeners(node)
    }
    if (node instanceof Element) {
      addMediaElements(node)
      if (node.shadowRoot) {
        observeRoot(node.shadowRoot)
      }
    }
  }

  function onMutation(): void {
    for (const mutation of queue) {
      mutation.addedNodes.forEach(scanNode)
    }
    queue.length = 0
  }

  const observer = new MutationObserver(function (mutations: MutationRecord[]) {
    if (!queue.length) {
      requestAnimationFrame(onMutation)
    }
    queue.push(...mutations)
  })

  const attachShadow = Element.prototype.attachShadow
  Element.prototype.attachShadow = function (
    init: ShadowRootInit,
  ): ShadowRoot {
    const shadowRoot = attachShadow.call(this, init)
    observeRoot(shadowRoot)
    return shadowRoot
  }

  observeRoot(document)
}

if ((window as any).gCrWebPlaceholderMediaBackgroundingEnabled) {
  enable()
}

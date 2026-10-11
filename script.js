document.documentElement.classList.add('js');

const body = document.body;
const toggleButton = document.querySelector('#toggle-dark-mode');
const themeColor = document.querySelector('meta[name="theme-color"]');
const storedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const historyTabs = [...document.querySelectorAll('.section-switch-option[role="tab"]')];
const photoGallery = document.querySelector('.photo-gallery');
const photoWheel = document.querySelector('.photo-wheel');
const originalPhotoThumbs = [...photoWheel.querySelectorAll('.photo-thumb')];

const photoFilename = (thumb) => thumb.querySelector('img').src.split('/').pop().split('?')[0];

const stablePhotoShuffleKey = (filename) => {
  let hash = 2166136261;

  for (const character of filename) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const shuffledPhotoThumbs = [...originalPhotoThumbs].sort((a, b) => {
  const filenameA = photoFilename(a);
  const filenameB = photoFilename(b);
  return stablePhotoShuffleKey(filenameA) - stablePhotoShuffleKey(filenameB)
    || filenameA.localeCompare(filenameB);
});

const photoOrientation = (thumb) => {
  const image = thumb.querySelector('img');
  const ratio = Number(image.getAttribute('width')) / Number(image.getAttribute('height'));
  if (ratio < 0.9) return 'portrait';
  if (ratio > 1.1) return 'landscape';
  return 'square';
};

const balancePhotoOrientations = (thumbs) => {
  if (thumbs.length < 2) return thumbs;

  const orientationLimits = { portrait: 3, landscape: 2, square: 1 };
  const orientationRhythm = [
    'portrait',
    'landscape',
    'portrait',
    'portrait',
    'landscape',
    'landscape',
    'portrait',
    'landscape',
    'portrait',
    'portrait',
    'portrait',
    'landscape',
    'landscape',
  ];
  const orientations = ['portrait', 'landscape', 'square'];
  const queues = Object.fromEntries(
    orientations.map((orientation) => [
      orientation,
      thumbs.filter((thumb) => photoOrientation(thumb) === orientation),
    ]),
  );
  const originalPositions = new Map(thumbs.map((thumb, index) => [thumb, index]));
  const startingIndexes = { portrait: 0, landscape: 0, square: 0 };
  const memo = new Map();

  const findBestSequence = (indexes, lastOrientation, runLength) => {
    const key = `${indexes.portrait}:${indexes.landscape}:${indexes.square}:${lastOrientation}:${runLength}`;
    if (memo.has(key)) return memo.get(key);

    const position = indexes.portrait + indexes.landscape + indexes.square;
    if (position === thumbs.length) return { overflow: 0, cost: 0, sequence: [] };

    let best = null;

    orientations.forEach((orientation) => {
      const queueIndex = indexes[orientation];
      if (queueIndex >= queues[orientation].length) return;

      const isRepeat = orientation === lastOrientation;
      const nextRunLength = isRepeat ? runLength + 1 : 1;
      const overflow = Math.max(0, nextRunLength - orientationLimits[orientation]);

      const nextIndexes = { ...indexes, [orientation]: queueIndex + 1 };
      const remainder = findBestSequence(nextIndexes, orientation, nextRunLength);
      if (!remainder) return;

      const thumb = queues[orientation][queueIndex];
      const preferredOrientation = orientationRhythm[position % orientationRhythm.length];
      const rhythmPenalty = orientation === preferredOrientation ? 0 : 8;
      const orderPenalty = Math.abs(originalPositions.get(thumb) - position) * 0.08;
      const candidate = {
        overflow: remainder.overflow + overflow,
        cost: remainder.cost + rhythmPenalty + orderPenalty,
        sequence: [thumb, ...remainder.sequence],
      };

      // Prefer satisfying the limits; spread unavoidable excess before considering rhythm.
      if (!best || candidate.overflow < best.overflow
        || (candidate.overflow === best.overflow && candidate.cost < best.cost)) best = candidate;
    });

    memo.set(key, best);
    return best;
  };

  const result = findBestSequence(startingIndexes, '', 0);
  return result ? result.sequence : thumbs;
};

const photoThumbs = balancePhotoOrientations(shuffledPhotoThumbs);
photoThumbs.forEach((thumb) => photoWheel.append(thumb));
const verticalPhotoRhythm = [-3, 6, -5, 3, -1, 5, -4];
const photoScaleRhythm = [1.08, 0.98, 1.02, 0.94, 1.1, 1, 0.96];

photoThumbs.forEach((thumb, index) => {
  const image = thumb.querySelector('img');
  const balancedHeight = Number.parseFloat(thumb.style.getPropertyValue('--thumb-height'))
    * photoScaleRhythm[index % photoScaleRhythm.length];

  thumb.style.setProperty('--thumb-height', `${balancedHeight.toFixed(1)}px`);
  thumb.style.setProperty('--thumb-shift', `${verticalPhotoRhythm[index % verticalPhotoRhythm.length]}px`);
  image.loading = index === 0 ? 'eager' : 'lazy';
  image.fetchPriority = index === 0 ? 'high' : 'auto';
});

const photoLightbox = document.querySelector('.photo-lightbox');
const photoLightboxImage = photoLightbox.querySelector('img');
const photoLightboxCaption = photoLightbox.querySelector('figcaption');
const photoLightboxPrevious = photoLightbox.querySelector('.photo-lightbox-previous');
const photoLightboxNext = photoLightbox.querySelector('.photo-lightbox-next');
let activePhotoIndex = 0;

const waitForPhoto = (image) => new Promise((resolve) => {
  if (image.complete) {
    resolve();
    return;
  }

  image.addEventListener('load', resolve, { once: true });
  image.addEventListener('error', resolve, { once: true });
});

const preparePhoto = async (image) => {
  await waitForPhoto(image);
  if (!image.naturalWidth) return false;

  try {
    await image.decode();
  } catch {
    return false;
  }

  return true;
};

const photoImages = photoThumbs.map((thumb) => thumb.querySelector('img'));
const preparedPhotos = photoImages.map(preparePhoto);
const staggerDelay = 18;

const revealPhotosLeftToRight = async () => {
  for (let index = 0; index < photoImages.length; index += 1) {
    const isReady = await preparedPhotos[index];
    if (!isReady) continue;

    photoImages[index].classList.add('is-loaded');
    await new Promise((resolve) => window.setTimeout(resolve, staggerDelay));
  }
};

revealPhotosLeftToRight();

const applyTheme = (mode) => {
  const isDark = mode === 'dark';
  const nextMode = isDark ? 'light' : 'dark';

  body.classList.toggle('dark-mode', isDark);
  toggleButton.textContent = nextMode;
  toggleButton.setAttribute('aria-label', `Switch to ${nextMode} mode`);
  toggleButton.setAttribute('aria-pressed', String(isDark));
  themeColor.setAttribute('content', isDark ? '#222724' : '#f5f5f5');
};

applyTheme(storedTheme || (prefersDark ? 'dark' : 'light'));

toggleButton.addEventListener('click', () => {
  const mode = body.classList.contains('dark-mode') ? 'light' : 'dark';
  localStorage.setItem('theme', mode);
  applyTheme(mode);
});

const selectHistoryTab = (selectedTab) => {
  historyTabs.forEach((tab) => {
    const isSelected = tab === selectedTab;
    tab.setAttribute('aria-selected', String(isSelected));
    document.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !isSelected;
  });
};

historyTabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectHistoryTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextTab = historyTabs[(index + direction + historyTabs.length) % historyTabs.length];
    selectHistoryTab(nextTab);
    nextTab.focus();
  });
});

const setLightboxPhoto = (index) => {
  activePhotoIndex = (index + photoThumbs.length) % photoThumbs.length;
  const thumb = photoThumbs[activePhotoIndex];
  const thumbnail = thumb.querySelector('img');

  photoLightboxImage.src = thumbnail.src;
  photoLightboxImage.alt = thumb.getAttribute('aria-label').replace(/^View /, '');
  photoLightboxCaption.textContent = thumb.dataset.location;
};

const openPhoto = (thumb) => {
  setLightboxPhoto(photoThumbs.indexOf(thumb));
  photoLightbox.showModal();
};

photoThumbs.forEach((thumb, index) => {
  thumb.addEventListener('click', () => openPhoto(thumb));
  thumb.addEventListener('keydown', (event) => {
    if (photoLightbox.open) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    const nextIndex = (index + direction + photoThumbs.length) % photoThumbs.length;
    const nextThumb = photoThumbs[nextIndex];
    nextThumb.focus({ preventScroll: true });
    nextThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  });
});

photoGallery.addEventListener('wheel', (event) => {
  if (photoGallery.scrollWidth <= photoGallery.clientWidth) return;
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;

  const maxScrollLeft = photoGallery.scrollWidth - photoGallery.clientWidth;
  // Allow page scrolling when moving outward from either end (including fractional offsets).
  if (event.deltaY < 0 && photoGallery.scrollLeft <= 1) return;
  if (event.deltaY > 0 && photoGallery.scrollLeft >= maxScrollLeft - 1) return;

  event.preventDefault();
  photoGallery.scrollLeft += event.deltaY;
}, { passive: false });
photoLightboxPrevious.addEventListener('click', () => setLightboxPhoto(activePhotoIndex - 1));
photoLightboxNext.addEventListener('click', () => setLightboxPhoto(activePhotoIndex + 1));
document.addEventListener('keydown', (event) => {
  if (!photoLightbox.open) return;
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

  event.preventDefault();
  const direction = event.key === 'ArrowRight' ? 1 : -1;
  setLightboxPhoto(activePhotoIndex + direction);
});
photoLightbox.addEventListener('click', (event) => {
  const clickedPreviewContent = event.target instanceof Element
    && event.target.closest('figure, .photo-lightbox-nav');

  if (!clickedPreviewContent) photoLightbox.close();
});


// Hover previews remain open across the gap and while their links have focus.
const bookTriggers = [...document.querySelectorAll('.reference-trigger')];
let activeBook = null;
let bookCloseTimer;
const closeBook = (restoreFocus = false) => {
  clearTimeout(bookCloseTimer);
  if (!activeBook) return;
  const { trigger, card } = activeBook;
  if (restoreFocus) trigger.focus();
  activeBook = null;
  card.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
};
const positionBook = () => {
  if (!activeBook) return;
  const { trigger, card, pointer } = activeBook;
  const rect = trigger.getBoundingClientRect();
  const width = card.offsetWidth;
  const anchorX = pointer ? pointer.x : rect.left + rect.width / 2;
  const anchorBottom = pointer ? pointer.y : rect.bottom;
  const left = Math.max(12, Math.min(anchorX - width / 2, window.innerWidth - width - 12));
  card.dataset.side = 'below';
  card.style.left = `${left}px`;
  card.style.top = `${anchorBottom + 14}px`;
  card.style.setProperty('--arrow-x', `${Math.max(12, Math.min(width - 12, anchorX - left))}px`);
};
const openBook = (trigger, pointer = null) => {
  clearTimeout(bookCloseTimer);
  if (activeBook?.trigger === trigger) return;
  closeBook();
  const card = document.getElementById(trigger.dataset.book);
  activeBook = { trigger, card, pointer };
  card.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
  positionBook();
};
const scheduleBookClose = () => {
  clearTimeout(bookCloseTimer);
  bookCloseTimer = setTimeout(() => {
    if (!activeBook) return;
    const { trigger, card } = activeBook;
    if (trigger.matches(':hover') || card.matches(':hover') || card.contains(document.activeElement) || document.activeElement === trigger) return;
    closeBook();
  }, 180);
};
bookTriggers.forEach((trigger) => {
  const card = document.getElementById(trigger.dataset.book);
  trigger.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'touch') openBook(trigger, { x: event.clientX, y: event.clientY });
  });
  trigger.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' || activeBook?.trigger !== trigger) return;
    activeBook.pointer = { x: event.clientX, y: event.clientY };
    positionBook();
  });
  trigger.addEventListener('focus', () => openBook(trigger));
  trigger.addEventListener('click', () => openBook(trigger));
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && !event.shiftKey && activeBook?.trigger === trigger) {
      const firstLink = card.querySelector('a');
      if (firstLink) {
        event.preventDefault();
        firstLink.focus();
      } else {
        closeBook();
      }
    }
  });
  [trigger, card].forEach((element) => {
    element.addEventListener('pointerleave', scheduleBookClose);
    element.addEventListener('focusout', scheduleBookClose);
  });
  card.addEventListener('pointerenter', () => clearTimeout(bookCloseTimer));
  card.addEventListener('focusin', () => clearTimeout(bookCloseTimer));
  card.addEventListener('keydown', (event) => {
    const links = [...card.querySelectorAll('a')];
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === links[0]) {
      event.preventDefault();
      trigger.focus();
    } else if (!event.shiftKey && document.activeElement === links[links.length - 1]) {
      event.preventDefault();
      const focusable = [...document.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]')].filter((element) => element.getClientRects().length && !element.closest('.book-popover'));
      const next = focusable[focusable.indexOf(trigger) + 1];
      closeBook();
      next?.focus();
    }
  });
});
document.addEventListener('pointerdown', (event) => {
  if (activeBook && !activeBook.card.contains(event.target) && !activeBook.trigger.contains(event.target)) closeBook();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activeBook) {
    const restore = activeBook.card.contains(document.activeElement);
    closeBook(restore);
  }
});
window.addEventListener('resize', positionBook);
window.addEventListener('scroll', () => closeBook(), { passive: true });


// Only the selected album is fetched; Spotify credentials never reach visitors.
(async () => {
  const placeholder = document.querySelector('#spotify-album');
  if (!placeholder) return;
  try {
    const response = await fetch('data/listening.json', { cache: 'no-cache' });
    if (!response.ok) return;
    const { album, updatedAt } = await response.json();
    const updated = Date.parse(updatedAt);
    if (!album?.name || !Number.isFinite(updated) || Date.now() - updated > 14 * 86400000) return;
    const url = new URL(album.url);
    if (url.origin !== 'https://open.spotify.com' || !/^\/album\/[A-Za-z0-9]+$/.test(url.pathname)) return;
    const link = document.createElement('a');
    link.className = 'underlined-link';
    link.href = url.href;
    link.textContent = album.name;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', `${album.name} on Spotify`);
    placeholder.replaceWith(link);
    document.querySelector('#spotify-listening')?.removeAttribute('hidden');
    const updatedLabel = document.querySelector('#listening-updated');
    if (updatedLabel) {
      updatedLabel.dateTime = new Date(updated).toISOString();
      updatedLabel.textContent = new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', timeZone: 'America/New_York'
      }).format(new Date(updated));
      document.querySelector('#listening-updated-row')?.removeAttribute('hidden');
    }
  } catch {
    // Keep the listening sentence hidden when Spotify data is unavailable.
  }
})();

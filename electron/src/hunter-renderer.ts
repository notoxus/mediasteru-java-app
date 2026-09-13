(() => {
  interface NavigationState {
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
    hunting: boolean;
    candidateCount: number;
    downloadReady: boolean;
    error?: string;
  }

  const hunterById = <T extends HTMLElement>(id: string): T => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing Hunter UI element: ${id}`);
    return node as T;
  };

  const form = hunterById<HTMLFormElement>('hunter-address-form');
  const address = hunterById<HTMLInputElement>('hunter-address');
  const addressShell = hunterById<HTMLDivElement>('hunter-address-shell');
  const backButton = hunterById<HTMLButtonElement>('hunter-back');
  const forwardButton = hunterById<HTMLButtonElement>('hunter-forward');
  const reloadButton = hunterById<HTMLButtonElement>('hunter-reload');
  const goButton = hunterById<HTMLButtonElement>('hunter-go');
  const huntingMode = hunterById<HTMLInputElement>('hunter-mode');
  const status = hunterById<HTMLSpanElement>('hunter-status');

  function showError(message: string): void {
    addressShell.classList.toggle('error', Boolean(message));
    addressShell.title = message;
    status.textContent = message;
  }

  function renderState(state: NavigationState): void {
    backButton.disabled = !state.canGoBack;
    forwardButton.disabled = !state.canGoForward;
    reloadButton.classList.toggle('loading', state.loading);
    reloadButton.setAttribute('aria-label', state.loading ? 'Page loading' : 'Reload page');
    huntingMode.checked = state.hunting;
    if (document.activeElement !== address && state.url) address.value = state.url;
    showError(state.error ?? '');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const target = address.value.trim();
    if (!target) {
      showError('Enter a URL or search term.');
      address.focus();
      return;
    }
    showError('');
    goButton.disabled = true;
    try {
      await window.hunterNavigation.navigate(target);
      address.blur();
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
      address.focus();
      address.select();
    } finally {
      goButton.disabled = false;
    }
  });

  backButton.addEventListener('click', () => void window.hunterNavigation.back());
  forwardButton.addEventListener('click', () => void window.hunterNavigation.forward());
  reloadButton.addEventListener('click', () => void window.hunterNavigation.reload());
  huntingMode.addEventListener('change', async () => {
    const requestedState = huntingMode.checked;
    huntingMode.disabled = true;
    try {
      renderState(await window.hunterNavigation.setHuntingMode(requestedState));
    } catch (error) {
      huntingMode.checked = !requestedState;
      showError(error instanceof Error ? error.message : String(error));
    } finally {
      huntingMode.disabled = false;
    }
  });
  address.addEventListener('input', () => showError(''));
  address.addEventListener('focus', () => address.select());

  window.hunterNavigation.onStateChanged(renderState);
  void window.hunterNavigation.getState().then(renderState);
})();

// Cashfree's web SDK is loaded on demand: most visitors never open the payment
// window, so there is no reason to ship it in the main bundle.
const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

let sdkPromise;

function loadSdk() {
  if (window.Cashfree) return Promise.resolve(window.Cashfree);
  sdkPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () =>
      window.Cashfree
        ? resolve(window.Cashfree)
        : reject(new Error('The payment window could not start. Please try again.'));
    script.onerror = () =>
      reject(new Error('Could not load the payment window. Check your connection and try again.'));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

// Opens Cashfree's hosted subscription-mandate checkout. Resolves once the
// window closes; on success Cashfree redirects to the return_url instead.
export async function openSubscriptionCheckout({ subsSessionId, mode }) {
  const Cashfree = await loadSdk();
  const cashfree = Cashfree({ mode: mode === 'production' ? 'production' : 'sandbox' });

  const checkout =
    typeof cashfree.subscriptionsCheckout === 'function'
      ? cashfree.subscriptionsCheckout.bind(cashfree)
      : cashfree.subscriptions?.checkout?.bind(cashfree.subscriptions);

  if (!checkout) throw new Error('The payment window is unavailable. Please try again later.');

  const result = await checkout({ subsSessionId, redirectTarget: '_self' });
  if (result?.error) throw new Error(result.error.message ?? 'Payment was not completed.');
}

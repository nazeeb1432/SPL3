import { RequestInterceptor } from './interceptor';

// Initialize and start the interceptor
const interceptor = new RequestInterceptor();
interceptor.start();

// Export for debugging
(window as any).DIY_MOD_INTERCEPTOR = interceptor;
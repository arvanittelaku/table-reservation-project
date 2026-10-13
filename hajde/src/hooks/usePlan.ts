/**
 * Re-exports usePlan from useStartupBundle so that any remaining
 * direct imports continue to work. The actual implementation is in
 * useStartupBundle.ts which consolidates profile + taste + affinity +
 * badges + plan into a single startup_bundle RPC call.
 */
export { usePlan } from './useStartupBundle'

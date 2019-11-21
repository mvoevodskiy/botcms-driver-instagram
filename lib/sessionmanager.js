
class SessionManager {
    constructor(options = {}) {
        this.IG = options.IG || {};
        this.contextKey = options.contextKey || 'session';
        this.getStorageKey = options.getStorageKey || (context => (String(context.thread_id) + ':' + String(context.user_id)));
        this.storage = options.storage || {
            set: (key, value) => this.IG.storeSet(key, value),
            get: (key) => this.IG.storeGet(key),
            delete: (key) => this.IG.storeSet(key, {}),
        };
        // }
        /**
         * Returns the middleware for embedding
         */
        // get middleware() {
        this.middleware = () => {
            const {storage, contextKey, getStorageKey} = this;
            return async (context, next) => {
                // console.log(context);
                const storageKey = getStorageKey(context);
                console.log(storageKey);
                let changed = false;
                const wrapSession = (targetRaw) => (
                    // eslint-disable-next-line no-use-before-define
                    new Proxy({...targetRaw, $forceUpdate}, {
                        set: (target, prop, value) => {
                            changed = true;
                            target[prop] = value;
                            return true;
                        },
                        deleteProperty(target, prop) {
                            changed = true;
                            delete target[prop];
                            return true;
                        }
                    }));
                const $forceUpdate = () => {
                    // eslint-disable-next-line no-use-before-define
                    if (Object.keys(session).length > 1) {
                        changed = false;
                        // eslint-disable-next-line no-use-before-define
                        return storage.set(storageKey, session);
                    }
                    return storage.delete(storageKey);
                };
                const initialSession = await storage.get(storageKey) || {};
                let session = wrapSession(initialSession);
                Object.defineProperty(context, contextKey, {
                    get: () => session,
                    set: (newSession) => {
                        console.log('INSTAGRAM SESSION MANAGER SET. NEW SESSION: ', newSession);
                        session = wrapSession(newSession);
                        changed = true;
                    }
                });
                await next();
                if (!changed) {
                    return;
                }
                await $forceUpdate();
            };
        }
    }
}

module.exports = SessionManager;
const { IgApiClient, IgCheckpointError } = require('instagram-private-api');
const Bluebird = require('bluebird');
const inquirer = require('inquirer');

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

const { promisify } = require('util');
const { writeFile, readFile, exists } = require('fs');

const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);
const existsAsync = promisify(exists);
const { FbnsClient } = require('instagram_mqtt');
// const { GraphQLSubscriptions } = require(require.resolve('instagram_mqtt').replace('/index.js', '') + '/realtime/subscriptions/graphql.subscription');

/** Instagram driver
 * @class
 *
 * @property {Object} defaults
 * @property {string} driverName
 * @property {string} name
 *
 * @property {BotCMS} BC
 * @property {IgApiClient} Transport
 */

class Instagram {
    constructor (BC, params = {}) {
        this.BC = BC;
        this.defaults = {
            name: 'ig',
            driverName: 'ig',
            humanName: 'Instagram',
            storage: 'instagram_db.json'
            // sessionHandler: SessionManager,
        };
        this.name = params.name || this.defaults.name;
        this.driverName = params.driverName || this.defaults.driverName;
        this.humanName = params.humanName || this.defaults.humanName;
        this.params = {
            username: params.username,
            password: params.password,
        };
        this.user = {
            'id': 0,
            'name': '',
            'username': '',
        };

        // this.ExtListener = new ExtListener();
        this.adapter = new FileSync(params.storage || this.defaults.storage);
        this.store = low(this.adapter);
        this.serviceKeys = ['__wrapped__', '__actions__', '__chain__', '__index__', '__values__', '$forceUpdate'];

        this.feeds = {};

        this.Transport = new IgApiClient();

        (async () => {
            this.Transport.state.generateDevice(params.username);
            this.Transport.state.proxyUrl = process.env.IG_PROXY;
        })();


        // this.Transport.updates.on('message', (new sessionHandler(sessionParams)).middleware);
    }

    isAvailable () {
        return typeof this.Transport === 'object';
    }

    on (feed, middleware) {
        this.feeds[feed] = this.feeds[feed] || [];
        this.feeds[feed].push(middleware);
    }

    async readInbox (t, feed) {
        // console.log('READ INBOX STARTED');
        const inboxFeed = t.Transport.feed[feed]();
        // const threads = await inboxFeed.items();
        inboxFeed.items$.subscribe(
            threads => {
                threads = threads.filter(x => x.read_state > 0);
                let updates = [];
                let newLast = !t.BC.T.empty(threads[0]) ? threads[0]['last_activity_at'] : 0;
                let storedinbox = t.storeGet('inbox');
                if (!storedinbox) {
                    t.storeSet('inbox', {
                        last: newLast,
                    });
                    storedinbox = t.storeGet('inbox');
                }
                for (let thread of threads) {
                    if (thread.last_activity_at > storedinbox.last) {
                        for (let msg of thread.items) {
                            if (msg.timestamp > storedinbox.last) {
                                if (msg.user_id !== t.user.id) {
                                    let update = {
                                        thread_id: thread.thread_id,
                                        item_id: msg.item_id,
                                        user_id: msg.user_id,
                                        timestamp: msg.timestamp,
                                        item_type: msg.item_type,
                                        text: msg.text || '',
                                        peerType: thread.is_group ? 'chat' : 'user',
                                    };
                                    updates.push(update);
                                }
                            } else {
                                break;
                            }
                        }
                        console.log(thread);
                        t.storeSet('inbox', {
                            last: thread['last_activity_at']
                        });
                    }

                }
                // console.log('INBOX FROM STORE ', t.storeGet('inbox'));
                // console.log(threads)
                updates.reverse();
                if (!t.BC.T.empty(updates)) {
                    // console.log('READ INBOX. NEW MESSAGES: ', updates);
                }
                for (let update of updates) {
                    t.defaultCallback(t, update);
                }
            },
            error => console.error(error),
            () => {},
        );
    }

    defaultCallback (t, update) {
        // console.log(update);
        // console.log(update.payload);

        /** @type {Context} **/
        let bcContext = new this.BC.classes.Context(this.BC, this, update);

        let chatType = '';
        switch (update.peerType) {
            case 'user':
                chatType = 'user';
                break;
            case 'chat':
                chatType = 'chat';
                break;
        }
        bcContext.Message.chat = {
            id: update.thread_id,
            type: chatType,
        };
        bcContext.Message.sender = {
            id: update.user_id,
            isBot: false,
        };
        bcContext.Message.id = update.item_id;
        bcContext.Message.date = Math.round(update.timestamp / 1000);
        bcContext.Message.text = update.text || '';

        return t.BC.handleUpdate(bcContext);
    }

    listen () {
        this.on('directInbox', this.readInbox);
        this.on('directPending', this.readInbox);
        // this.Transport.updates.on('message', (ctx) => {return this.defaultCallback(this, ctx)});
    }

    kbBuild (keyboard, recursive = false) {
        let kb = [];
        return kb;
    }

    kbRemove (ctx) {
        console.log('[IG] KB REMOVE');
        return [];
    }

    reply (ctx, Parcel) {
        console.log(Parcel);
        return this.send(Parcel);
    }

    send (Parcel) {

        return (async () => {
            const thread = this.Transport.entity.directThread(Parcel.peerId);
            return await thread.broadcastText(Parcel.message);
        })();
    }

    async launch(middleware, ...middlewares) {
        Bluebird.try(async () => {
            (async () => {
                const ig = this.Transport;
                // console.log('IG ASYNC. TRANSPORT TO ig ASSIGNED');
                const fbnsClient = new FbnsClient(ig);
                // console.log('IG ASYNC. FBNS CLIENT CREATED');
                await this.readState(ig, fbnsClient);
                await this.loginToInstagram(ig, fbnsClient);
                fbnsClient.on('direct_v2_message', data => this.handleDirect(this, data));
                fbnsClient.on('push', this.logEvent('push'));
                fbnsClient.on('auth', async (auth) => {
                    // this.logEvent('auth')(auth);
                    await this.saveState(ig, fbnsClient);
                });
                fbnsClient.on('error', this.logEvent('error'));
                fbnsClient.on('warning', this.logEvent('warning'));

                await fbnsClient.connect();
                console.log('IG MQTT started');
            })();
        }).catch(IgCheckpointError, async () => {
            console.log(this.Transport.state.checkpoint); // Checkpoint info here
            await this.Transport.challenge.auto(true); // Requesting sms-code or click "It was me" button
            console.log(this.Transport.state.checkpoint); // Challenge info here
            const { code } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'code',
                    message: 'Enter code',
                },
            ]);
            console.log(await this.Transport.challenge.sendSecurityCode(code));
        });
    }

    async loginToInstagram(ig, fbns) {
        ig.request.end$.subscribe(() => this.saveState(ig, fbns));
        const auth = await ig.account.login(this.params.username, this.params.password);
        // console.log(auth);
        this.user.id = auth.pk;
        this.user.name = auth.full_name;
        this.user.username = auth.username;
        this.user.full_name = auth.full_name;
    }

    async readState(ig, fbns) {
        if (!await existsAsync('state.json'))
            return;
        // normal reading of state for the instagram-api
        const { cookies, state, fbnsAuth } = JSON.parse(await readFileAsync('state.json', { encoding: 'utf8' }));
        // console.log(JSON.parse(await readFileAsync('state.json', { encoding: 'utf8' })));
        ig.state.deviceString = state.deviceString;
        ig.state.deviceId = state.deviceId;
        ig.state.uuid = state.uuid;
        ig.state.phoneId = state.phoneId;
        ig.state.adid = state.adid;
        ig.state.build = state.build;
        await ig.state.deserializeCookieJar(cookies);
        // this reads the auth
        fbns.auth.read(fbnsAuth);
    }

    async saveState(ig, fbns) {
        const cookies = await ig.state.serializeCookieJar();
        const state = {
            deviceString: ig.state.deviceString,
            deviceId: ig.state.deviceId,
            uuid: ig.state.uuid,
            phoneId: ig.state.phoneId,
            adid: ig.state.adid,
            build: ig.state.build,
        };
        return writeFileAsync('state.json', JSON.stringify({
            cookies: JSON.stringify(cookies),
            state,
            fbnsAuth: fbns.auth.toString(),
        }), { encoding: 'utf8' });
    }

    logEvent (name) {
        return data => {
            console.log(name, data);
        }
    }

    async approvePending (threadId) {
        return await this.Transport.directThread.approve(threadId);
    }

    async fetchUserInfo (userId) {
        let result = {};
        if (userId === this.BC.SELF_SEND || userId === 0) {
            result = this.user;
        } else {
            if (typeof userId === 'string') {
                userId = await client.user.getIdByUsername(username);
            }
            let userInfo = await this.Transport.user.info(userId);
            console.log(userInfo);
            result = {
                id: userInfo.pk,
                username: userInfo.username,
                full_name: userInfo.full_name,
                type: 'user',
            }
        }
        return result;
    }

    async handleDirect (t, data) {
        const threadId = data.actionParams.id;
        if (!t.BC.T.empty(data.pushCategory) && data.pushCategory === 'direct_v2_pending') {
            await t.approvePending(threadId);
        } else {
            let message = data.message.substr(data.message.indexOf(':') + 2);
            console.log('IG INBOUND MESSAGE: <' + message + '>');
        }

        return t.readInbox(t, 'directInbox');
    }

    fetchUpdates (t) {
        setTimeout(() => {
            console.log('NEW ROUND');
            for (const feed in t.feeds) {
                if (t.feeds.hasOwnProperty(feed)) {
                    for (const middleware of t.feeds[feed]) {
                        middleware(t, feed);
                    }
                }
            }
            t.fetchUpdates(t);
        }, 3000);
    }

    storeGet (key) {
        let value = this.store.get(key) || null;
        return value.__wrapped__[key];
    }

    storeSet (key, value) {
        let primitive = {};
        // console.log('VK SES LOW. SESSION SET KEY ' + key + ', VALUE ', value);
        for (let k in value) {
            if (value.hasOwnProperty(k) && this.serviceKeys.indexOf(k) === -1) {
                primitive[k] = value[k];
                // console.log('OWN PROPERTY KEY ' + k + ' VALUE ', value[k]);
            }
        }
        // console.log('OWN PROPERTY KEY ' + key + ' FINAL VALUE ', primitive);
        this.store.set(key, primitive).write();
        // console.log('VK SES LOW. SESSION SET KEY ' + key /*+ ', ALL ', this.store*/);
        return true;
    }
}


module.exports = Object.assign(Instagram, {Instagram});
module.exports.default = Object.assign(Instagram, {Instagram});
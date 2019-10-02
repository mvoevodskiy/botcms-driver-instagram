const { IgApiClient, IgCheckpointError } = require('instagram-private-api');
const Bluebird = require('bluebird');
const inquirer = require('inquirer');

/** Instagram driver
 * @class
 *
 * @property {Object} defaults
 * @property {string} driverName
 * @property {string} name
 *
 * @property {BotCMS} BC
 * @property {VK} Transport
 */

class Instagram {
    constructor (BC, params = {}) {
        this.BC = BC;
        this.defaults = {
            name: 'ig',
            driverName: 'ig',
            // sessionHandler: SessionManager,
        };
        this.name = params.name || this.defaults.name;
        this.driverName = params.driverName || this.defaults.driverName;
        this.params = {
            username: params.username,
            password: params.password,
        };

        this.events = {

        };

        this.Transport = new IgApiClient();

        // let sessionHandler = params.sessionHandler || this.defaults.sessionHandler;
        // let sessionParams = params.sessionParams || {};
        // sessionParams.getStorageKey = sessionParams.getStorageKey || (context => (String(context.peerId) + ':' + String(context.senderId)));

        function fakeSave(cookies, state) {
            return {
                cookies,
                state,
            };
        }

        (async () => {
            this.Transport.state.generateDevice(params.username);
            this.Transport.state.proxyUrl = process.env.IG_PROXY;
            // This function executes after every request
            this.Transport.request.end$.subscribe(async () => {
                // Here you have JSON object with cookies.
                // You could stringify it and save to any persistent storage

                // const cookies = await this.Transport.state.serializeCookieJar();
                // const state = {
                //     deviceString: this.Transport.state.deviceString,
                //     deviceId: this.Transport.state.deviceId,
                //     uuid: this.Transport.state.uuid,
                //     phoneId: this.Transport.state.phoneId,
                //     adid: this.Transport.state.adid,
                //     build: this.Transport.state.build,
                // };
                // fakeSave(JSON.stringify(cookies), state);

                // In order to restore session cookies you need this

                // await this.Transport.state.deserializeCookieJar(JSON.stringify(cookies));
                // this.Transport.state.deviceString = state.deviceString;
                // this.Transport.state.deviceId = state.deviceId;
                // this.Transport.state.uuid = state.uuid;
                // this.Transport.state.phoneId = state.phoneId;
                // this.Transport.state.adid = state.adid;
                // this.Transport.state.build = state.build;
            });
            // This call will provoke request.$end stream

            // const inboxFeed = this.Transport.feed.directInbox();
            // const threads = await inboxFeed.items();
            // console.log(threads[0]);
            // const thread = this.Transport.entity.directThread(threads[0].thread_id);
            // await thread.broadcastText('test message');
            // await thread.broadcastPhoto({
            //     file: readFileSync('./tools/images/original.jpg'),
            // });
        })();


        // this.Transport.updates.on('message', (new sessionHandler(sessionParams)).middleware);
    }

    isAvailable () {
        return typeof this.Transport === 'object';
    }

    defaultCallback (t, ctx) {
        if (ctx.payload.out === 1) {
            return;
        }
        // console.log(ctx);
        // console.log(ctx.payload);

        /** @type {Context} **/
        let bcContext = new this.BC.classes.Context(this.BC, this, ctx);

        let chatType = '';
        switch (ctx.peerType) {
            case 'user':
                chatType = 'user';
                break;
            case 'chat':
                chatType = 'chat';
                break;
        }
        bcContext.Message.chat = {
            id: ctx.peerId,
            type: chatType,
        };
        bcContext.Message.sender = {
            id: ctx.senderId,
            isBot: ctx.senderType !== 'user',
        };
        bcContext.Message.id = ctx.id;
        bcContext.Message.date = ctx.createdAt;
        bcContext.Message.text = ctx.text || '';

        if (!this.BC.T.empty(ctx.replyMessage)) {
            bcContext.Message.reply = {
                id: ctx.replyMessage.id,
                text: ctx.replyMessage.text,
                chatId: ctx.replyMessage.peerId,
                senderId: ctx.replyMessage.senderId,
            }
        }


        if (!this.BC.T.empty(ctx.attachments)) {
            for (const attachment of ctx.attachments) {

                let props = {
                    type: attachment.type,
                    owner: attachment.ownerId,
                    name: String(attachment),
                };

                if (attachment.type === 'photo') {
                    let sizes = {};

                    for (const size of attachment.sizes) {
                        sizes[size.type] = size;
                    }
                    console.log(sizes);
                    let photo = sizes.w || sizes.z || sizes.y;
                    props.height = photo.height;
                    props.wigth = photo.width;
                    props.link = photo.url;
                    props.type = this.BC.ATTACHMENTS.PHOTO;
                }

                bcContext.Message.handleAttachment(props);
            }
        }

        return t.BC.handleUpdate(bcContext);
    }

    listen () {
        // this.Transport.updates.on('message', (ctx) => {return this.defaultCallback(this, ctx)});
    }

    kbBuild (keyboard, recursive = false) {
        // console.log(keyboard.buttons);
        let kb = [];
        if (keyboard.options.indexOf('simple') > -1) {
            for (let key in keyboard.buttons) {
                if (!keyboard.buttons.hasOwnProperty(key)) {
                    continue;
                }
                if (Array.isArray(keyboard.buttons[key])) {
                    kb[key] = this.kbBuild({
                        buttons: keyboard.buttons[key],
                        options: keyboard.options
                    }, true);
                } else {
                    kb[key] = Keyboard.textButton({
                        label: keyboard.buttons[key],
                        payload: {
                            command: keyboard.buttons[key]
                        }
                    });
                }
            }
            // let kb = Markup.keyboard(keyboard.buttons);
            //
            // // console.log(kb.removeKeyboard);
            // // kb = kb.removeKeyboard();
            //
            // for (let option of keyboard.options) {
            //     console.log('[TG] BUILD KB. OPTION: ' + option + ', kb[option]: ', kb[option]);
            //     if (!this.BC.T.empty(kb[option])) {
            //         console.log('[TG] BUILD KB. OPTION FOUND: ' + option);
            //         kb = kb[option]();
            //     }
            // }
            // return kb;
        }
        if (!recursive) {
            kb = Keyboard.keyboard(kb);
            if (keyboard.options.indexOf('oneTime') > -1) {
                kb = kb.oneTime(true);
            }
        }
        console.log(kb);
        return kb;
    }

    kbRemove (ctx) {
        console.log('[VK] KB REMOVE');
        return [];
    }

    reply (ctx, Parcel) {
        console.log(Parcel);
        return ctx.send({
            message: Parcel.message,
            keyboard: Parcel.keyboard,
        });
    }

    send (Parcel) {

        return (async (Parcel) => {
            const thread = this.Transport.entity.directThread(Parcel.peerId);
            return await thread.broadcastText(Parcel.message);
        })();
        // keyboard: Parcel.keyboard,
    }

    async launch(middleware, ...middlewares) {
        Bluebird.try(async () => {
            const auth = await this.Transport.account.login(this.params.username, this.params.password);
            console.log(auth);
            const inboxFeed = this.Transport.feed.directInbox();
            // const threads = await inboxFeed.items();
            inboxFeed.items$.subscribe(
                threads => console.log(threads),
                error => console.error(error),
                () => console.log('Complete!'),
            );

            setTimeout(() => {
                inboxFeed.items$.subscribe(
                    threads => console.log(threads),
                    error => console.error(error),
                    () => console.log('Complete!'),
                );
            }, 10000);
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

        // await this.Transport.account.login(this.params.username, this.params.password);
        console.log('IG started');
    }
}


module.exports = Object.assign(Instagram, {Instagram});
module.exports.default = Object.assign(Instagram, {Instagram});
// Datafund
// Todo: add license etc
// Todo: Authors

// datareceipt.js library uses fds.js library to send consent receipt files over Swarm to another account
//
// 1. create account 1
// 2. unlock account
// 3. load project file
// 4. load private key
// 5. generate cr.jwt token
// 6. send cr.jwt token to yourself and wait for delivery
// 7. get all received files
// 8. for each received file check if its cr.jwt token
// 9. decode token
// 10. if decoded then verify token display info
// 11. repeat from step 5.
//
import FDS from 'fds.js';
import jwt from "jsonwebtoken";

//import Consent from './consent/Consent.js';
import ConsentManager from './consent/ConsentManager.js';

let account = null;

class DataReceiptLib {
    constructor() {
        this.options = {};
        this.account = null;
        this.privateKey = null;
        this.project = null;
        this.receiving = false;
        this.receivedMessages = [];
        this.multiboxData = [];
        this.consentManager = null;
        this.FDS = new FDS();
        this.FDS.applicationDomain = '/shared/consents';
    }


    async createAccount(accountName, password, errorCallback = console.log, callback = console.log) {
        try {
            let createdAccount = await this.FDS.CreateAccount(accountName.toLowerCase(), password, callback);
            return createdAccount;
        } catch (err) {
            if (errorCallback) errorCallback(err);
        }
        return null;
    }

    async unlockAccount(subdomain, password) {
        this.account = await this.FDS.UnlockAccount(subdomain.toLowerCase(), password);
        await this.checkDomain(this.FDS.applicationDomain);

        return this.account;
    }

    async restoreAccount(json, filename, password) {
        let file = new File([json], filename, { type: 'text/plain' });
        let subdomain = null;
        try {
            await this.FDS.RestoreAccount(file);
        }
        catch (err) {
            console.error(err);
            try {
                let match = file.name.match(/fds-wallet-(.*)-backup/);
                if (match.length === 2) {
                    subdomain = match[1];
                    this.unlockAccount(subdomain, password);
                }
            } catch (err2) {
                console.error(err2);
                console.error("can't unlock, bad pass? expecting wallet in form: <fds-wallet-ACCOUNTNAME-backup> ?");
            }
        }

        let accounts = await this.FDS.GetAccounts();
        console.log(`accounts in local storage: ${accounts.length} `);
    }

    //////////////////////////////////////////////////////////////////////////////////////
    // check proper domain exists for account
    async checkDomain(applicationDomain, callback = console.log) {
        await this.getMultiboxData();
        let multiboxAddress = this.multiboxData.id;
        let kvtId = 0;
        return multiboxAddress;
    }
    async getAddressOf(subdomain) {
        let contact = await this.account.lookupContact(subdomain);
        let hex = "0x" + contact.publicKey.substring(2, 132);
        let hash = this.account.Tx.web3.utils.keccak256(hex);
        let recipientAddress = "0x" + hash.slice(24 + 2);
        return recipientAddress;
    }
    /** retrieve multibox data
     * */
    async getMultiboxData() {
        this.multibox = await this.account.getMultibox(this.account.subdomain);
        this.multiboxData = await this.multibox.get('/');
        //console.log(this.multiboxData);
        return this.multiboxData;
    }

    async getConsentManager() {
        if (this.consentManager === null) {
            this.consentManager = new ConsentManager(this.account);
            //console.log("consentManager", this.consentManager);
        }
        return this.consentManager;
    }

    async getConsent(consentContractAddress) {
        let consentContract = await this.consentManager.getConsentAt(consentContractAddress);
        await consentContract.getSwarmHash();
        return consentContract;
    }

    // import account
    async loadProject(project, errorCallback = console.log, callback = console.log) {
        if (project.hasOwnProperty('formData') && project.hasOwnProperty('defaultProperties')) {
            if (project.defaultProperties.hasOwnProperty('tokenSigningOptions')) {
                let options = project.defaultProperties.tokenSigningOptions;
                if (options.hasOwnProperty('issuer') && options.hasOwnProperty('subject') &&
                    options.hasOwnProperty('audience') && options.hasOwnProperty('expiresIn') &&
                    options.hasOwnProperty('algorithm')) {

                    this.project = project;
                    if (callback) callback("project looks valid");
                    return true;
                } else {
                    if (errorCallback) errorCallback("no valid options, requires issuer, subject, audience, expiresIn, algorithm");
                }
            } else {
                if (errorCallback) errorCallback("no valid defaultProperties, requires tokenSigningOptions");
            }
        } else {
            if (errorCallback) errorCallback("no valid formData, defaultProperties");
        }

        if (errorCallback) errorCallback("not a valid consent project");
        return false;
    }
    async loadPrivateKey(privateKey) {
        this.privateKey = privateKey;
        return this.privateKey;
    }
    async generateToken(errorCallback = console.log, callback = console.log) {
        if (this.account === null) {
            if (errorCallback) errorCallback("invalid account");
        }
        if (this.privateKey === null || this.project === null) {
            if (errorCallback) errorCallback("invalid project setup");
        }
        if (callback) callback("generating token from project");
        return await this.generate(this.project.formData, this.privateKey, this.project.defaultProperties.tokenSigningOptions);
    }
    /**
     *
     * @param {any} token
     * @param {any} toAccountSubdomain
     * @param {any} errorCallback
     * @param {any} callback
     * @returns {hash} swarm location hash
     */
    async sendDataReceipt(token, toAccountSubdomain, errorCallback = console.log, callback = console.log) {
        if (this.account === null) {
            if (errorCallback) errorCallback("invalid account receiving and sending will not work");
            return;
        }

        if (callback) callback(`${this.account.subdomain} sending to ${toAccountSubdomain}`);
        let r = Math.floor(Date.now());
        let file = new File([`${token}`], `${r}.cr.jwt`, { type: 'application/jwt' });

        try {
            let resultHash = await this.account.send(toAccountSubdomain, file, this.FDS.applicationDomain, callback, callback, callback);

            console.log(resultHash);

            if (callback) callback(`${this.account.subdomain} sent ${resultHash.hash.address} >>>> ${toAccountSubdomain}`);
            return resultHash.hash.address;
        } catch (err) {
            if (errorCallback) errorCallback(err);
            try {
                if (err.search("pubKey") !== -1)
                    if (errorCallback) errorCallback("Probably recepient does not exits");
            } catch (err2) {
                if (errorCallback) errorCallback(err2);
            }
        }
    }
    /**
     * Get All Messages Account Received
     * @param {any} decodeAndVerifyToken  each message that is cr.jwt will be decoded and signature verified
     * @param {any} downloadCallback callback
     * @param {any} decryptionCallback callback
     * @param {any} errorCallback callback
     * @param {any} callback callback
     */
    async getReceivedMessages(decodeAndVerifyToken = false, downloadCallback = null, decryptionCallback = null, errorCallback = null, callback = null) {

        if (this.account === null) {
            if (errorCallback) errorCallback("no account");
            return null;
        }
        if (this.receiving === true) {
            if (errorCallback) errorCallback("already receiving");
            return this.receivedMessages;
        }

        this.receiving = true; // avoid pileing

        let messages = await this.account.messages('received', this.FDS.applicationDomain);
        var reader = new FileReader();

        await this.asyncForEach(messages, async (message) => {
            var file = await message.getFile(); // what if this fails?
            var isCRJWT = await this.IsConsentRecepit(file.name);
            var id = message.hash.address;

            // was not yet added
            if (!await this.findReceived(id)) {
                let context = this;
                reader.onload = function (e) {
                    //let content = ExtractMessage(reader.result);
                    context.addReceivedMessage(decodeAndVerifyToken, { id: id, message: message, data: reader.result, isConsentRecepit: isCRJWT, decodedToken: null, verified: false, signed: null }, errorCallback, callback);
                    if (callback) callback(id, message);
                }
                await reader.readAsText(await this.account.receive(message, decryptionCallback, downloadCallback));
            }
        });
        if (this.receiving === false) return;
        return this.receivedMessages;
    }
    /**
     * adds recevied message, also decodes token and verifies signature
     * @param {any} decodeAndVerifyToken
     * @param {any} receivedMessage
     * @param {any} errorCallback
     * @param {any} callback
     */
    async addReceivedMessage(decodeAndVerifyToken, receivedMessage, errorCallback = null, callback = null) {
        try {
            if (decodeAndVerifyToken)
                await this.decodeTokenFrom(receivedMessage, errorCallback, callback);

            this.receivedMessages.push(receivedMessage);
            if (callback) callback("added", receivedMessage);
        } catch (err) { if (errorCallback) errorCallback(err); }
    }

    /**
     * Decodes token from message
     * {
     *    id: int - must be unique, could be message.hash.address,
     *    message: pointer to fds.message,
     *    data: contents of file,
     *    isConsentRecepit: bool,
     *    decodedToken: null,
     *    signed: signature info
     *    verified: bool
     * }
     * @param {any} receivedMessage
     * @param {any} errorCallback
     * @param {any} callback
     */
    async decodeTokenFrom(receivedMessage, errorCallback = null, callback = null) {
        try {
            receivedMessage.decodedToken = await this.decode(receivedMessage.data);
            if (receivedMessage.decodedToken !== null) {

                let tokenOptions = {
                    "issuer": receivedMessage.decodedToken.payload.iss, //"Datafund",
                    "subject": receivedMessage.decodedToken.payload.sub, // "Consent Receipt",
                    "audience": receivedMessage.decodedToken.payload.aud, //"https://datafund.io",
                    //"expiresIn": "48h",
                    "algorithm": receivedMessage.decodedToken.header.alg
                }

                receivedMessage.signed = await this.verify(receivedMessage.decodedToken.payload.publicKey, receivedMessage.data, tokenOptions, callback);

                receivedMessage.verified = receivedMessage.signed !== false;

                if (callback) callback(receivedMessage, receivedMessage.verified, receivedMessage.decodedToken);
            }
        } catch (err) { if (errorCallback) errorCallback(err); }
    }


    async sendContents(fromAccount, toAccount, applicationDomain, message) {
        //console.log(`${fromAccount.subdomain} sending to ${toAccount}`);
        let r = Math.floor(Date.now());
        let file = new File([`fds-${r}-message: ${message}`], `fds-msg-${r}.txt`, { type: 'text/plain' });

        try {
            let result = await fromAccount.send(toAccount, file, applicationDomain, console.log, console.log, console.log);
            console.log(fromAccount.subdomain, "sent", result, ">>>", toAccount);
            return result;
        } catch (err) {
            console.error(err);
            try {
                if (err.search("pubKey") !== -1)
                    console.log("Probably recepient does not exits");
            } catch (err2) {
                console.error(err2);
            }
        }
    }


    //////////////////////////////////////////////////////////////////////////////////////
    // These functions are required to generate, verify, decode jwt token
    /** generate jwt token with algo specified in options
     */
    generate(formData, privateKey, options) {
        return jwt.sign(formData, privateKey, options);
    }
    /** verify jwt token with RS256 algo
     */
    verify(publicKey, jwtToken, options = this.options, callback = null) {
        //console.log("publicKey ", publicKey);
        try {
            let legit = jwt.verify(jwtToken, publicKey, options);
            if (callback) callback("Signature VALID!", legit);
            return legit;
        } catch (e) {
            if (callback) callback("Invalid signature!", jwtToken, publicKey, options);
        }
        return false;
    }
    /** decodes jwt token
     */
    decode(jwtToken) {
        return jwt.decode(jwtToken, { complete: true });
    }
    /** generates JWT token with data from project
     */
    generateFrom(project, privateKey, errorCallback = console.log) {
        try {
            return this.generate(project.formData, privateKey, project.defaultProperties.tokenSigningOptions);
        } catch (err) { if (errorCallback) errorCallback(err); }

        return null;
    }

    //////////////////////////////////////////////////////////////////////////////////////
    // Helper functions

    async asyncForEach(array, callback) {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    }
    async IsConsentRecepit(data, callback = console.log) {
        try {
            var match = data.match(/(.*).cr.jwt/);
            if (match.length === 2) {
                return true;
            } else {
                //callback("not an Consent receipt");
            }
        } catch (err) {
            callback(err);
        }
        return false;
    }
    async findReceived(msgId) {
        return this.receivedMessages.find(msg => msg.id === msgId);
    }
}

export default DataReceiptLib;
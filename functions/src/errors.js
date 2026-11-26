'use strict';

/** Thrown when a source rejects our saved login and the owner has to sign in again. */
class NeedsLogin extends Error {
  constructor(message) {
    super(message);
    this.needsLogin = true;
  }
}

module.exports = { NeedsLogin };

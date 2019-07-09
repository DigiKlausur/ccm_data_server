/**
 * @overview Javscript module containing helper functions
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2019
 * @license MIT License
 */

module.exports = {
  createSaltHashPair: _createSaltHashPair,
  encryptKey: _encryptKey,
  isObject: _isObject,
  convertKey: _convertKey,
  convertDataset: _convertDataset,
  reconvertDataset: _reconvertDataset,
  isKey: _isKey,
  reconvertKey: _reconvertKey,
  clone: _clone
};

/*  Import server configurations */
const configs = require( "../config/configs" );

/* Import JS modules */
const crypto = require( 'crypto' );

/**
 * @overview create a new random token and password pair based on the given secret key
 */
function _createSaltHashPair( key ) {
  return new Promise( ( resolve, reject ) => {
    const randSaltBuffer = crypto.randomBytes( configs.encryption.key_length );
    _encryptKey( key, randSaltBuffer ).then(
      encryptedKey => {
        const saltHashPair = {
          'salt': randSaltBuffer.toString( configs.encryption.key_encoding ),
          'token': encryptedKey
        };
        resolve( saltHashPair );
      },
      reason => reject( reason ) );
  } );
}  // end function createSaltHashPair()

/**
 * @overview encrypt key given a salt buffer
 */
function _encryptKey( key, salt ) {
  return new Promise( ( resolve, reject ) => {
    let saltBuffer;
    if ( typeof salt === 'string' ) {
      saltBuffer = Buffer.from( salt, configs.encryption.key_encoding );
    } else if ( Buffer.isBuffer( salt ) ) {
      saltBuffer = salt;
    } else {
      console.log( 'invalid salt type: ' + typeof salt );
      reject( 'server error' );
      return;
    }
    crypto.scrypt( key, saltBuffer, configs.encryption.key_length, ( err, derivedKey ) => {
      if ( err ) {
        reject( 'failed to create user token' );
        return;
      }
      resolve( derivedKey.toString( configs.encryption.key_encoding ) );
    });
  } );
}  // end _encryptKey()

/**
 * checks value if it is an object (including not null and not array)
 * @param {*} value - value to check
 * @returns {boolean}
 */
function _isObject( value ) {
  return typeof value === 'object' && value !== null && !Array.isArray( value );
}

/**
 * converts ccm dataset key to MongoDB dataset key
 * @param {ccm.types.key} key - ccm dataset key
 * @returns {string} MongoDB dataset key
 */
function _convertKey( key ) {
  return Array.isArray( key ) ? key.join() : key;
}

/**
 * converts ccm dataset to MongoDB dataset
 * @param {Object} ccm_dataset - ccm dataset
 * @returns {ccm.types.dataset} MongoDB dataset
 */
function _convertDataset( ccm_dataset ) {
  const mongodb_dataset = _clone( ccm_dataset );
  mongodb_dataset._id = _convertKey( mongodb_dataset.key );
  delete mongodb_dataset.key;
  return mongodb_dataset;
}

/**
 * reconverts MongoDB dataset to ccm dataset
 * @param {Object} mongodbDataset - MongoDB dataset
 * @returns {ccm.types.dataset} ccm dataset
 */
function _reconvertDataset( mongodbDataset ) {
  const ccmDataset = _clone( mongodbDataset );
  ccmDataset.key = _reconvertKey( ccmDataset._id );
  delete ccmDataset._id;
  return ccmDataset;
}

/**
 * checks if a value is a valid ccm dataset key
 * @param {*} value - value to check
 * @returns {boolean}
 */
function _isKey( value ) {
  /**
   * definition of a valid dataset key
   * @type {RegExp}
   */
  const regex = /^[a-zA-Z0-9_\-]+$/;

  // value is a string? => check if it is an valid key
  if ( typeof value === 'string' ) return regex.test( value );

  // value is an array? => check if it is an valid array key
  if ( Array.isArray( value ) ) {
    for ( let i = 0; i < value.length; i++ )
      if ( !regex.test( value[ i ] ) )
        return false;
    return true;
  }

  // value is not a dataset key? => not valid
  return false;
}  // end isKey()

/**
 * converts MongoDB key to ccm dataset key
 * @param {string} key - MongoDB dataset key
 * @returns {ccm.types.key} ccm dataset key
 */
function _reconvertKey( key ) {
  return typeof key === 'string' && key.indexOf( ',' ) !== -1 ? key.split( ',' ) : key;
}

/**
 * makes a deep copy of an object
 * @param {Object} obj - object
 * @returns {Object} deep copy of object
 */
function _clone( obj ) {
  return JSON.parse( JSON.stringify( obj ) );
}

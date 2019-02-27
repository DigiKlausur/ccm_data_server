/**
 * @overview NodeJS webserver for server-side ccm data management via HTTP using MongoDB
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2018-2019
 * @description customize the implementation at https://github.com/ccmjs/data-server for the DigiKlausur project
 * @license MIT License
 */

// web server configurations
const configs = require( "./config/configs" );

// used web server configuration
const config = configs.digiklausur;

// load required npm modules
let   mongodb     = require( 'mongodb' );
const fs          = require( 'fs'  );
const http        = require( 'http' );
const https       = require( 'https' );
const deparam     = require( 'node-jquery-deparam' );
const moment      = require( 'moment' );
const crypto      = require( 'crypto');
const roleParser  = require( './js/role_parser' );

// create connection to MongoDB
connectMongoDB( () => { if ( !mongodb || !config.mongo ) console.log( 'No MongoDB found => Server runs without MongoDB.' );

  // start webserver
  startWebserver();

  /** starts a HTTP webserver with websocket support */
  function startWebserver() {

    if ( config.https ) {
      const credentials = {
        key:  fs.readFileSync( config.privateKey ),
        cert: fs.readFileSync( config.certificate ),
        ca:   fs.readFileSync( config.ca )
      };
      const https_server = https.createServer( credentials, handleRequest );

      // start HTTPS webserver
      https_server.listen( config.https.port );

      console.log( 'HTTPS server started at: https://' + config.domain + ':' + config.https.port );

    } else if ( config.http ) {
      const http_server = http.createServer( handleRequest );

      // start HTTP webserver
      http_server.listen( config.http.port );

      console.log( 'HTTP server started at: http://' + config.domain + ':' + config.http.port);

    } else {
      console.error( "neither 'http' or 'https' configuration specified" );
    }
  }

  /**
   * handles incoming HTTP requests
   * @param request
   * @param response
   */
  function handleRequest( request, response ) {

    // handle 'OPTION' requests
    if ( request.method === 'OPTIONS' ) {
      response.setHeader( 'Access-Control-Allow-Origin', '*' );
      response.setHeader( 'Access-Control-Allow-Headers', 'Content-Type' );
      response.statusCode = 200;
      response.end();
      return;
    }

    // receive HTTP parameter data
    if ( request.method === 'POST' ) {
      let body = '';
      request.on( 'data', data => {
        body += data;
        if ( body.length > config.max_data_size )
          request.shouldKeepAlive = false;
      } );
      request.on( 'end', () => {
        if ( body.length > config.max_data_size ) {
          response.statusCode = 413;
          response.end();
        }
        else {
          try {
            proceed( JSON.parse( body ) );
          } catch ( e ) {
            response.statusCode = 403;
            response.end();
          }
        }
      } );
    }
    else
      proceed( deparam( request.url.substr( 2 ) ) );

    /** @param {*} data - received data */
    function proceed( data ) {

      // support cross domain requests via CORS
      response.setHeader( 'Access-Control-Allow-Origin', '*' );

      // received invalid data? => abort and send 'Forbidden'
      if ( !checkReceivedData( data ) ) return sendForbidden();

      // no database operation? => abort and send 'Forbidden'
      if ( !data.get && !data.set && !data.del ) return sendForbidden();

      // perform database operation
      performDatabaseOperation( data ).then(
          result => {
            // send result to client
            result === undefined ? sendForbidden() : send( data.get ? result : ( data.set ? result.key : true ) );
            },
            reason => { sendForbidden( reason ); }
          );

      /**
       * sends response to client
       * @param {*} response_data
       */
      function send( response_data ) {

        // response is not a string? => transform data to JSON string
        response_data = typeof response_data !== 'string' ? JSON.stringify( response_data ) : response_data;

        // set response HTTP header
        response.writeHead( 200, { 'content-type': 'application/json; charset=utf-8' } );

        // send response data to client
        response.end( response_data );

      }
      /** sends 'Forbidden' status code */
      function sendForbidden( message ) {
        message = typeof message !== 'string' ? JSON.stringify( message ) : message;
        response.writeHead( 403, { 'content-type': 'application/json; charset=utf-8' } );
        response.end( message );
      }
    }

  }

  /**
   * checks if received data is valid
   * @returns {boolean} false in case of invalid data
   */
  function checkReceivedData( data ) {

    if ( data.store && typeof data.store !== 'string' ) return false;
    if ( data.get && !isKey( data.get ) && !isObject( data.get ) ) return false;
    if ( data.set ) {
      if (                  !isObject( data.set  ) ) return false;
      if ( !data.set.key || !isKey( data.set.key ) ) return false;
    }
    if ( data.del && !isKey( data.del ) ) return false;

    // received data is valid
    return true;

  }

  /**
   * performs database operation
   * @param {Object} data - received data
   */
  function performDatabaseOperation( data ) {

    // select kind of database
    return useMongoDB();

    /** performs database operation in MongoDB */
    function useMongoDB() {

      // check authentication
      return new Promise( ( resolve, reject ) => {
        getUserInfo().then(
          userInfo => {
            // get collection
            mongodb.collection( data.store, ( err, collection ) => {

              // determine and perform correct database operation
              if ( data.get ) {
                // read document
                return get().then(
                    results => { resolve( results ); },
                    reason => { reject( reason ); }
                    );
              } else if ( data.set ) {
                // create or update document
                return set().then(
                    results => { resolve( results ); },
                    reason => { reject( reason ); }
                );
              } else if ( data.del ) {
                // delete document
                return del().then(
                    results => { resolve( results ); },
                    reason => { reject( reason ); }
                );
              }

              /** reads dataset(s) and call resolve with read dataset(s) */
              function get() {
                if ( !roleParser.isDocOpAllowed( userInfo.role, userInfo.username, data.store, data.get, 'get' ) ) {
                  return Promise.reject( 'user unauthorized' );
                }

                // perform read operation
                return getDataset( collection, data.get ).then( results => {
                  // call resolve on read resolve
                  return Promise.resolve( results );
                });
              }  // end function get()

              /** creates or updates dataset and call resolve with created/updated dataset */
              function set() {
                return new Promise( ( resolve, reject ) => {
                  if ( !roleParser.isDocOpAllowed(
                            userInfo.role, userInfo.username, data.store, data.set.key, 'set' ) ) {
                    reject( 'user unauthorized' );
                    return;
                  }

                  // perform create/update operation
                  setDataset( collection, data.set ).then(
                      results => resolve(results),
                      reason => reject(reason)
                  );
                } );
              }  // end function set()

              /** deletes dataset and resolves Promise with deleted dataset */
              function del() {
                return new Promise( ( resolve, reject ) => {
                  if ( !roleParser.isDocOpAllowed( userInfo.role, userInfo.username, data.store, data.del, 'del' ) ) {
                    reject( 'user unauthorized' );
                    return;
                  }

                  // read existing dataset
                  getDataset( collection, data.del ).then( existing_dataset => {
                    // delete dataset and call resolve with deleted dataset
                    collection.deleteOne( { _id: convertKey( data.del ) }, () => resolve( existing_dataset ) );
                  } );
                } );
              }  // end function del()

            } );  // end mongodb.collection()

          },  // end onfulfilled handler

          reason => reject( reason)   // getUserInfo() rejection handler

        )  // end getUserInfo().then()

      });  // end return new Promise()

      /**
       * @overview manage user information
       * - if user doesn't exist, create a new entry with default value
       * - if user exist, authenticate using received token
       * @return Promise
       *          - onfulfilled param: object containing user information
       *          - onrejected param: rejection reason
       */
      function getUserInfo() {
        return new Promise( ( resolve, reject ) => {
          mongodb.collection( 'users', ( err, collection ) => {
            // no user data to verify
            if ( !data.token ) return;

            // parse token string
            const tokenChunks = data.token.split('#');
            if ( tokenChunks.length !== 2 ) return;
            const username = tokenChunks[0];
            const token = tokenChunks[1];

            collection.countDocuments( {}, { limit: 2 }, ( err, count ) => {
              // if no user, create first one as admin
              if ( count === 0 ) {
                createNewUser( username, 'admin', token ).then (
                    newUserInfo => {
                      // write new user info to database
                      setDataset( collection, newUserInfo ).then(
                          results => getDataset( collection, results.key ).then( userData => resolve( userData ) ),
                          reason => reject( reason )
                      );
                    },
                    reason => reject( reason )
                );
                return;
              }

              // get user info
              getDataset( collection, username ).then( results => {
                let userInfo = results;
                if ( !userInfo ) {
                  createNewUser( username, roleParser.getDefaultRole(), token ).then (
                      newUserInfo => {
                        // write new user info to database
                        setDataset( collection, newUserInfo ).then(
                            results => getDataset( collection, results.key ).then( userData => resolve( userData ) ),
                            reason => reject( reason )
                        );
                      },
                      reason => reject( reason )
                  );
                  return;
                }

                if ( !userInfo.salt || !userInfo.token ) {
                  // if no user or no salt/hash for user create new TODO: interface for resetting salt/hash
                  createSaltHashPair( token ).then(
                      saltHashPair => {
                        // update userInfo
                        Object.assign( userInfo, saltHashPair );

                        // write new user info to database
                        setDataset( collection, userInfo ).then(
                            results => getDataset( collection, results.key ).then( userData => resolve( userData ) ),
                            reason => reject( reason )
                        );
                      },
                      reason => reject( reason )
                  );
                  return;
                }

                // if salt hash doesn't match reject
                crypto.scrypt( token, Buffer.from( userInfo.salt, config.key_encoding ), config.key_length,
                    ( err, derived_key ) => {
                      if ( err ) {
                        reject( 'unable to calculate hash from stored salt and token: ' + err.message );
                        return;
                      }
                      if ( derived_key.toString( config.key_encoding ) === userInfo.token )
                        resolve( userInfo );
                      else
                        reject( 'token does not match' );
                    } );

              } );  // end getDataset().then()

            } );  // end collection.count()

          } );  // end mongodb.collection()

        })  // end return new Promise()

      }  // end function getUserInfo()

      /**
       * @overview update/create a document in collection
       * @param collection: mongodb Collection
       * @param setData {Object}: contains 'key' field which specify document '_id', and data to write
       */
      function setDataset( collection, setData ) {
        return new Promise( ( resolve, reject ) => {
          getDataset( collection, setData.key ).then( existing_dataset => {

            /**
             * priority data
             * @type {ccm.types.dataset}
             */
            const prioData = convertDataset( setData );
            // respond to send on successful update
            const resolveData = { key: setData.key };

            // set 'updated_at' timestamp
            prioData.updated_at = moment().format();

            if ( existing_dataset ) {
              /**
               * attributes that have to be unset
               * @type {Object}
               */
              const unset_data = {};
              for ( const key in prioData )
                if ( prioData[ key ] === '' ) {
                  unset_data[ key ] = prioData[ key ];
                  delete prioData[ key ];
                }

              // update dataset
              if ( Object.keys( unset_data ).length > 0 ) {
                collection.updateOne( { _id: prioData._id }, { $set: prioData, $unset: unset_data },
                    () => resolve( resolveData ) );
              } else {
                collection.updateOne( { _id: prioData._id }, { $set: prioData }, () => resolve( resolveData ) );
              }
            } else {
              // create operation => add 'created_at' timestamp and perform create operation
              prioData.created_at = prioData.updated_at;
              collection.insertOne( prioData, () => resolve( resolveData ) );
            }

          } );  // end getDataset().then()

        });  // end return new Promise()

      }  // end function setDataset()

      /**
       * reads dataset(s)
       * @param collection: MongoDB collection
       * @param {ccm.types.key|Object} key_or_query - dataset key or MongoDB query
       */
      function getDataset( collection, key_or_query ) {

        return new Promise( ( resolve, reject ) => {
          // read dataset(s)
          const query = isObject( key_or_query ) ? key_or_query : { _id: convertKey( key_or_query ) };
          collection.find( query ).toArray( ( err, res ) => {

            // convert MongoDB dataset(s) in ccm dataset(s)
            for ( let i = 0; i < res.length; i++ )
              res[ i ] = reconvertDataset( res[ i ] );

            // read dataset by key? => result is dataset or NULL
            if ( !isObject( key_or_query ) ) res = res.length ? res[ 0 ] : null;

            // resolve Promise reconverted result(s)
            resolve( res );
          } );
        } );
      }  // end function getDataset()

      /**
       * @overview create new user info document to write to database
       */
      function createNewUser( username, role, token ) {
        // create new user entry if one does not exist
        let userInfo = {
          'key': username,
          'username': username,
          'role': role
        };

        return new Promise( ( resolve, reject ) => {
          // create new salt-hash pair
          createSaltHashPair( token ).then(
              saltHashPair => {
                // update userInfo
                Object.assign( userInfo, saltHashPair );
                resolve( userInfo );
              },
              reason => reject( reason )
          );
        } );
      }  // end function createNewUser()

    }  // end function useMongoDB()
  }  // end function performDatabaseOperation()

  /**
   * @overview create a new random token and password pair based on the given secret key
   */
  function createSaltHashPair( key ) {
    return new Promise( ( resolve, reject ) => {
      const randSaltBuffer = crypto.randomBytes( config.key_length );
      let saltHashPair;
      crypto.scrypt( key, randSaltBuffer, config.key_length, ( err, derivedKey ) => {
        saltHashPair = { 'salt': randSaltBuffer.toString( config.key_encoding ) };
        if ( err ) {
          reject( 'failed to create user token: ' + err.message );
          return;
        }
        saltHashPair.token = derivedKey.toString( config.key_encoding );
        resolve( saltHashPair );
      });
    } );
  }  // end function createSaltHashPair()

  /**
   * converts ccm dataset to MongoDB dataset
   * @param {Object} ccm_dataset - ccm dataset
   * @returns {ccm.types.dataset} MongoDB dataset
   */
  function convertDataset( ccm_dataset ) {

    const mongodb_dataset = clone( ccm_dataset );
    mongodb_dataset._id = convertKey( mongodb_dataset.key );
    delete mongodb_dataset.key;
    return mongodb_dataset;

  }

  /**
   * reconverts MongoDB dataset to ccm dataset
   * @param {Object} mongodb_dataset - MongoDB dataset
   * @returns {ccm.types.dataset} ccm dataset
   */
  function reconvertDataset( mongodb_dataset ) {

    const ccm_dataset = clone( mongodb_dataset );
    ccm_dataset.key = reconvertKey( ccm_dataset._id );
    delete ccm_dataset._id;
    return ccm_dataset;

  }

  /**
   * converts ccm dataset key to MongoDB dataset key
   * @param {ccm.types.key} key - ccm dataset key
   * @returns {string} MongoDB dataset key
   */
  function convertKey( key ) {

    return Array.isArray( key ) ? key.join() : key;

  }

  /**
   * converts MongoDB key to ccm dataset key
   * @param {string} key - MongoDB dataset key
   * @returns {ccm.types.key} ccm dataset key
   */
  function reconvertKey( key ) {
    return typeof key === 'string' && key.indexOf( ',' ) !== -1 ? key.split( ',' ) : key;
  }

  /**
   * checks if a value is a valid ccm dataset key
   * @param {*} value - value to check
   * @returns {boolean}
   */
  function isKey( value ) {
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
  }

  /**
   * checks value if it is an object (including not null and not array)
   * @param {*} value - value to check
   * @returns {boolean}
   */
  function isObject( value ) {
    return typeof value === 'object' && value !== null && !Array.isArray( value );
  }

  /**
   * makes a deep copy of an object
   * @param {Object} obj - object
   * @returns {Object} deep copy of object
   */
  function clone( obj ) {
    return JSON.parse( JSON.stringify( obj ) );
  }

} );  // end connectMongoDB()

/**
 * creates a connection to MongoDB
 * @param {function} callback
 * @param {boolean} waited
 */
function connectMongoDB( callback, waited ) {
  if ( !mongodb || !config.mongo ) return callback();
  mongodb.MongoClient.connect( `${config.mongo.uri}:${config.mongo.port}`, { useNewUrlParser: true }, ( err, client ) => {
    if ( !err ) { mongodb = client.db( 'digiklausur' ); return callback(); }
    if ( !waited ) setTimeout( () => connectMongoDB( callback, true ), 3000 );
    else { mongodb = null; callback(); }
  } );
}

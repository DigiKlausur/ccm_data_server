/**
 * @overview NodeJS webserver for server-side ccm data management via HTTP using MongoDB
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2018-2019
 * @description customize the implementation at https://github.com/ccmjs/data-server for the DigiKlausur project
 * @license MIT License
 */

// web server configurations
const configs = require("./configs");

// used web server configuration
const config = configs.local;

// load required npm modules
let   mongodb     = require( 'mongodb' );
const http        = require( 'http' );
const deparam     = require( 'node-jquery-deparam' );
const moment      = require( 'moment' );
const crypto      = require( 'crypto');
const roleParser  = require( './role_parser' );

// create connection to MongoDB
connectMongoDB( () => { if ( !mongodb || !config.mongo ) console.log( 'No MongoDB found => Server runs without MongoDB.' );

  // start webserver
  startWebserver();

  /** starts a HTTP webserver with websocket support */
  function startWebserver() {

    // create HTTP webserver
    const http_server = http.createServer( handleRequest );

    // start HTTP webserver
    http_server.listen( config.http.port );

    console.log( 'Server is running. Now you can use this URLs on client-side:' );
    console.log( '- http://' + config.domain + ':' + config.http.port + ' (using HTTP protocol)' );

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
      performDatabaseOperation( data ).then( result => {
        // send result to client
        result === undefined ? sendForbidden() : send( data.get ? result : ( data.set ? result.key : true ) );
      } );

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
      function sendForbidden() {
        response.statusCode = 403;
        response.end();
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
   * @param {function} callback - callback (first parameter is/are result(s))
   */
  function performDatabaseOperation( data ) {

    // select kind of database
    return useMongoDB();

    /** performs database operation in MongoDB */
    function useMongoDB() {
      // check authentication
      return new Promise( ( resolve, reject ) => {
        getUserInfo().then( userInfo => {
        // get collection
        mongodb.collection( data.store, ( err, collection ) => {

          // determine and perform correct database operation
          if      ( data.get ) return get( collection, data.get ).then( results => resolve(results) );            // read
          else if ( data.set ) return set( collection, data.set ).then( results => resolve(results) );  // create or update
          else if ( data.del ) return del( collection, data.del ).then( results => resolve(results));   // delete
        } );
      } )

      });

      /** END OF STATEMENTS **/
      function getUserInfo() {
        return new Promise( resolve => {
          mongodb.collection( 'users', ( err, collection ) => {
            // no user data to verify
            if (!data.token) return;

            // parse token string
            const tokenChunks = data.token.split('#');
            if ( tokenChunks.length !== 2 ) return;
            const username = tokenChunks[0];
            const token = tokenChunks[1];

            // get user info
            getDataset( collection, username ).then( results => {
              let userInfo = results;
              if ( !userInfo ) {
                userInfo = {
                  'key': username,
                  'role': roleParser.getDefaultRole()
                };
                set( collection, userInfo ).then( results => resolve(results) );
                return;
              }
              resolve(userInfo);
              // if no user or no salt/hash for user create new TODO: interface for resetting salt/hash
              // if salt hash doesn't match set role to undefined
              // else get and return role TODO: interface for admin to change role
            } );
          } );
        })
      }

      /** reads dataset(s) and call resolve with read dataset(s) */
      function get( collection, documentKey ) {
        // perform read operation
        return getDataset( collection, documentKey ).then( results => {
          // call resolve on read resolve
          return Promise.resolve( results );
        });
      }

      /** creates or updates dataset and call resolve with created/updated dataset */
      function set( collection, setData ) {

        return new Promise( ( resolve, reject ) => {
          getDataset( collection, setData.key ).then( existing_dataset => {

            /**
             * priority data
             * @type {ccm.types.dataset}
             */
            const priodata = convertDataset( setData );
            // respond to send on successful update
            const resolveData = { key: setData.key };

            // set 'updated_at' timestamp
            priodata.updated_at = moment().format();

            if ( existing_dataset ) {
              /**
               * attributes that have to be unset
               * @type {Object}
               */
              const unset_data = {};
              for ( const key in priodata )
                if ( priodata[ key ] === '' ) {
                  unset_data[ key ] = priodata[ key ];
                  delete priodata[ key ];
                }

              // update dataset
              if ( Object.keys( unset_data ).length > 0 ) {
                collection.updateOne( { _id: priodata._id }, { $set: priodata, $unset: unset_data },
                                      () => resolve( resolveData ) );
              } else {
                collection.updateOne( { _id: priodata._id }, { $set: priodata }, () => resolve( resolveData ) );
              }
            } else {
              // create operation => add 'created_at' timestamp and perform create operation
              priodata.created_at = priodata.updated_at;
              collection.insertOne( priodata, () => resolve( resolveData ) );
            }
          } );
        } );
      }

      /** deletes dataset and resolves Promise with deleted dataset */
      function del( collection, documentKey ) {
        return new Promise( ( resolve, reject ) => {
          // read existing dataset
          getDataset( collection, documentKey ).then( existing_dataset => {
            // delete dataset and call resolve with deleted dataset
            collection.deleteOne( { _id: convertKey( documentKey ) }, () => resolve( existing_dataset ) );
          } );
        } );
      }

      /**
       * reads dataset(s)
       * @param collection
       * @param {ccm.types.key|Object} key_or_query - dataset key or MongoDB query
       */
      function getDataset( collection, key_or_query ) {

        return new Promise( ( resolve, reject ) => {
          // read dataset(s)
          collection.find( isObject( key_or_query ) ? key_or_query : { _id: convertKey( key_or_query ) } ).toArray( ( err, res ) => {

            // convert MongoDB dataset(s) in ccm dataset(s)
            for ( let i = 0; i < res.length; i++ )
              res[ i ] = reconvertDataset( res[ i ] );

            // read dataset by key? => result is dataset or NULL
            if ( !isObject( key_or_query ) ) res = res.length ? res[ 0 ] : null;

            // resolve Promise reconverted result(s)
            resolve( res );
          } );
        } );
      }
    }
  }

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

} );

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

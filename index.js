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
      performDatabaseOperation( data, result => {

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
  function performDatabaseOperation( data, callback ) {

    // select kind of database
    useMongoDB();

    /** performs database operation in MongoDB */
    function useMongoDB() {
      // check authentication
      let userInfo;
      mongodb.collection( 'users', ( err, collection ) => {
        // no user data to verify
        if (!data.token) return;

        // parse token string
        const tokenChunks = data.token.split('#');
        if ( tokenChunks.length !== 2 ) return;
        const username = tokenChunks[0];
        const token = tokenChunks[1];

        getDataset( collection, username, results => {
          if ( !results ) {
            // if no collection create new
          }
          // if no user or no salt/hash for user create new TODO: interface for resetting salt/hash
          // if salt hash doesn't match set role to undefined
          // else get and return role TODO: interface for admin to change role
        } );
      } );

      // get collection
      mongodb.collection( data.store, ( err, collection ) => {

        // determine and perform correct database operation
        if      ( data.get ) get(collection);                           // read
        else if ( data.set ) set(collection);                           // create or update
        else if ( data.del ) del(collection);                           // delete

      } );

      /** END OF STATEMENTS **/

      /** reads dataset(s) and performs callback with read dataset(s) */
      function get(collection) {
        // perform read operation
        getDataset( collection, data.get, results => {
          // finish operation
          finish( results );
        } );
      }

      /** creates or updates dataset and perform callback with created/updated dataset */
      function set( collection ) {

        // read existing dataset
        getDataset( collection, data.set.key, existing_dataset => {

          /**
           * priority data
           * @type {ccm.types.dataset}
           */
          const priodata = convertDataset( data.set );

          // set 'updated_at' timestamp
          priodata.updated_at = moment().format();

          // dataset exists? (then it's an update operation)
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
            if ( Object.keys( unset_data ).length > 0 )
              collection.updateOne( { _id: priodata._id }, { $set: priodata, $unset: unset_data }, success );
            else
              collection.updateOne( { _id: priodata._id }, { $set: priodata }, success );

          }
          // create operation => add 'created_at' timestamp and perform create operation
          else { priodata.created_at = priodata.updated_at; collection.insertOne( priodata, success ); }

          /** when dataset is created/updated */
          function success() {

            // perform callback with created/updated dataset
            getDataset( collection, data.set.key, finish );

          }
        } );
      }

      /** deletes dataset and performs callback with deleted dataset */
      function del( collection ) {
        // read existing dataset
        getDataset( collection, data.del, existing_dataset => {
          // delete dataset and perform callback with deleted dataset
          collection.deleteOne( { _id: convertKey( data.del ) }, () => finish( existing_dataset ) );
        } );
      }

      /**
       * reads dataset(s)
       * @param collection
       * @param {ccm.types.key|Object} key_or_query - dataset key or MongoDB query
       * @param {function} callback - callback (first parameter is/are read dataset(s))
       */
      function getDataset( collection, key_or_query, callback ) {

        // read dataset(s)
        collection.find( isObject( key_or_query ) ? key_or_query : { _id: convertKey( key_or_query ) } ).toArray( ( err, res ) => {

          // convert MongoDB dataset(s) in ccm dataset(s)
          for ( let i = 0; i < res.length; i++ )
            res[ i ] = reconvertDataset( res[ i ] );

          // read dataset by key? => result is dataset or NULL
          if ( !isObject( key_or_query ) ) res = res.length ? res[ 0 ] : null;

          // perform callback with reconverted result(s)
          callback( res );

        } );

      }
    }

    /** finishes database operation */
    function finish( results ) {
      // perform callback with result(s)
      callback( results );
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
    if ( !err ) { mongodb = client.db( 'ccm' ); return callback(); }
    if ( !waited ) setTimeout( () => connectMongoDB( callback, true ), 3000 );
    else { mongodb = null; callback(); }
  } );
}

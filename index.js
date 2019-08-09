/**
 * @overview NodeJS webserver for server-side ccm data management via HTTP using MongoDB
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2018-2019
 * @description customize the implementation at https://github.com/ccmjs/data-server for the DigiKlausur project
 * @license MIT License
 */

// web server configurations
const configs   = require( "./config/configs" );
const curProtocol = 'http';

// load required npm modules
let   mongodb   = require( 'mongodb' );
const fs        = require( 'fs'  );
const http      = require( 'http' );
const https     = require( 'https' );
const deparam   = require( 'node-jquery-deparam' );

// load library modules
const helpers   = require( './js/helpers' );
const userOps   = require( './js/user_operations' );
const mongoOps  = require( './js/mongodb_operations' );
const qaOps     = require( './js/qa_operations' );

// create connection to MongoDB
connectMongoDB( () => {
  if ( !mongodb || !configs.mongo ) console.log( 'No MongoDB found => Server runs without MongoDB.' );

  // start webserver
  startWebserver();

  /** starts a HTTP webserver with websocket support */
  function startWebserver() {

    if ( curProtocol === 'https' ) {
      const credentials = {
        key:  fs.readFileSync( configs.protocol[ curProtocol ].privateKey ),
        cert: fs.readFileSync( configs.protocol[ curProtocol ].certificate ),
        ca:   fs.readFileSync( configs.protocol[ curProtocol ].ca )
      };
      const https_server = https.createServer( credentials, handleRequest );

      // start HTTPS webserver
      https_server.listen( configs.protocol[ curProtocol ].port );

      console.log( 'HTTPS server started at: https://' + configs.domain + ':' + configs.protocol[ curProtocol ].port );

    } else if ( curProtocol === 'http' ) {
      const http_server = http.createServer( handleRequest );

      // start HTTP webserver
      http_server.listen( configs.protocol[ curProtocol ].port );

      console.log( 'HTTP server started at: http://' + configs.domain + ':' + configs.protocol[ curProtocol ].port);

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
        if ( body.length > configs.max_data_size )
          request.shouldKeepAlive = false;
      } );
      request.on( 'end', () => {
        if ( body.length > configs.max_data_size ) {
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
    if ( data.get && !helpers.isKey( data.get ) && !helpers.isObject( data.get ) ) return false;
    if ( data.set ) {
      if (                  !helpers.isObject( data.set  ) ) return false;
      if ( !data.set.key || !helpers.isKey( data.set.key ) ) return false;
    }
    if ( data.del && !helpers.isKey( data.del ) ) return false;

    // received data is valid
    return true;

  }

  /**
   * performs database operation
   * @param {Object} data - received data
   */
  function performDatabaseOperation( data ) {

    // check authentication
    return new Promise( ( resolve, reject ) => {
      // parse store string of format '<store_name>#<course_id>'
      const chunks = data.store.split( '#' );
      if ( chunks.length != 2 ) {
        reject( 'store string format is invalid or does not contain course ID' );
        return;
      }
      data.store = chunks[0];
      const courseId = chunks[1];

      // get user information
      const userInfoProm = userOps.getUserInfo( mongodb, data.token, courseId );

      // check that the document requested is part of the
      const courseDocCheckProm = userInfoProm.then(
        userInfo => {
          return new Promise( ( resolve, reject ) => {
            mongodb.collection( 'courses', ( err, courseCollection ) => {
              if ( err ) {
                reject( err );
                return;
              }

              mongoOps.getDataset( courseCollection, courseId )
              .then( courseDoc => {
                if ( !courseDoc ) courseDoc = { 'key': courseId, 'roles': {}, 'collections': {} };

                // if requested store is on record and belongs to the course, resolve
                if ( courseDoc.collections[ data.store ] ) return userInfo;

                // if user is admin, add store to course document
                if ( userInfo[ 'is_admin' ] ) {
                  courseDoc.collections[ data.store ] = true;
                  return mongoOps.setDataset( courseCollection, courseDoc ).then( () => userInfo );
                }

                // reject
                return Promise.reject( 'store does not belong to course' );
              } )
              .then(
                userInfo => resolve( userInfo ),
                reason => reject( reason ) );
            } );
          });
        }
      );

      // handle data request
      courseDocCheckProm.then(
        userInfo => {
          // get collection
          mongodb.collection( data.store, async ( err, collection ) => {
            if ( err ) {
              reject( err );
              return;
            }

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
              if ( !userOps.isDocOpAllowed( userInfo.role, userInfo.username, data.store, data.get, 'get' ) ) {
                return Promise.reject( 'user unauthorized' );
              }

              if ( data.get === 'role' ) {
                return Promise.resolve( { name: userInfo.role } );
              }

              // perform read operation
              return mongoOps.getDataset( collection, data.get );
            }  // end function get()

            /** creates or updates dataset and call resolve with created/updated dataset */
            function set() {
              return new Promise( ( resolve, reject ) => {
                if ( !userOps.isDocOpAllowed(
                          userInfo.role, userInfo.username, data.store, data.set.key, 'set' ) ) {
                  reject( 'user unauthorized' );
                  return;
                }

                handleSpecialSet( data.set ).then( setData => {
                  // perform create/update operation
                  mongoOps.setDataset( collection, setData ).then(
                    results => resolve( results ),
                    reason => reject( reason )
                  );
                } );

                // handle special SET requests, propagate 'setData' as promise result or change it as needed
                function handleSpecialSet( setData ) {
                  return new Promise ( ( resolve, reject ) => {
                    if ( setData.key === userInfo.username ) {
                      qaOps.updateAnswerDoc( collection, userInfo.username, setData );
                    }  // end if setData.key === username

                    resolve( setData );
                  } );
                }
              } );
            }  // end function set()

            /** deletes dataset and resolves Promise with deleted dataset */
            function del() {
              return new Promise( ( resolve, reject ) => {
                if ( !userOps.isDocOpAllowed( userInfo.role, userInfo.username, data.store, data.del, 'del' ) ) {
                  reject( 'user unauthorized' );
                  return;
                }

                // read existing dataset
                mongoOps.getDataset( collection, data.del ).then( existing_dataset => {
                  // delete dataset and call resolve with deleted dataset
                  collection.deleteOne( { _id: helpers.convertKey( data.del ) }, () => resolve( existing_dataset ) );
                } );
              } );
            }  // end function del()

          } );  // end mongodb.collection()

        },  // end onfulfilled handler

        reason => reject( reason )   // getUserInfo() rejection handler

      )  // end getUserInfo().then()

    });  // end return new Promise()

  }  // end function performDatabaseOperation()

} );  // end connectMongoDB()

/**
 * creates a connection to MongoDB
 * @param {function} callback
 * @param {boolean} waited
 */
function connectMongoDB( callback, waited ) {
  if ( !mongodb || !configs.mongo ) return callback();
  mongodb.MongoClient.connect(
    `${configs.mongo.uri}:${configs.mongo.port}`, { useNewUrlParser: true },
    ( err, client ) => {
      if ( !err ) { mongodb = client.db( 'digiklausur' ); return callback(); }
      if ( !waited ) setTimeout( () => connectMongoDB( callback, true ), 3000 );
      else { mongodb = null; callback(); }
    } );
}

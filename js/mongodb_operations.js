/**
 * @overview Javscript module for handling MongoDB database operations
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2019
 * @license MIT License
 */
module.exports = {
  getDataset: _getDataset,
  setDataset: _setDataset
};

/* Load npm modules */
const moment  = require( 'moment' );
/* Load library modules */
const helpers = require('./helpers')

/**
 * reads dataset(s)
 * @param collection: MongoDB collection
 * @param {ccm.types.key|Object} key_or_query - dataset key or MongoDB query
 */
function _getDataset( collection, key_or_query ) {

  return new Promise( ( resolve, reject ) => {
    // read dataset(s)
    const query = helpers.isObject( key_or_query ) ? key_or_query : { _id: helpers.convertKey( key_or_query ) };
    collection.find( query ).toArray( ( err, res ) => {

      // convert MongoDB dataset(s) in ccm dataset(s)
      for ( let i = 0; i < res.length; i++ )
        res[ i ] = helpers.reconvertDataset( res[ i ] );

      // read dataset by key? => result is dataset or NULL
      if ( !helpers.isObject( key_or_query ) ) res = res.length ? res[ 0 ] : null;

      // resolve Promise reconverted result(s)
      resolve( res );
    } );
  } );
}  // end function getDataset()

/**
 * @overview update/create a document in collection
 * @param collection: mongodb Collection
 * @param setData {Object}: contains 'key' field which specify document '_id', and data to write
 */
function _setDataset( collection, setData ) {
  return new Promise( ( resolve, reject ) => {
    _getDataset( collection, setData.key ).then( existing_dataset => {

      /**
       * priority data
       * @type {ccm.types.dataset}
       */
      const prioData = helpers.convertDataset( setData );
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

    } );  // end mongoOps.getDataset().then()

  });  // end return new Promise()

}  // end function setDataset()

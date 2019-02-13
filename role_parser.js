/**
 * @overview Javscript module for parsing user access, for working with user_roles.json
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2019
 * @license MIT License
 */

// get configured user roles
const roles = require("./user_roles");

// only support CCM database operations for now
const allowedOperations = [ 'get', 'set', 'del' ];

module.exports = {
  isAllowed: function( roleName, username, collectionName, operation ) {
      /**
       * supported keywords:
       *    %all%: permission apply for all collections
       *    %user%: permission apply only for the specific user's collection
       *
       * @param roleName: specifies access level of the user
       * @param username: will be used for matching collection name, each user should have RW access to a collection
       *                  whose name matches their username
       * @param collectionName: name of collection to access
       * @param operation: operation to be performed on the the DB collection
       */
      // roleName not recognized
      if ( !roles[ roleName ] ) return false;

      // operation not recognized
      if ( !isOpAllowed(allowedOperations, operation) ) return false;

      const permissions = roles[ roleName ].permissions;
      for ( let i = 0; i < permissions.length; i++ ) {
          // keyword %all%: operation allowed for all collections
          if ( permissions[i].id === '%all%' && isOpAllowed( permissions[i].operations, operation ) )
              return true;

          // keyword %user%: collection name must match username TODO: can extend to regex match here
          if ( permissions[i].id === '%user%' && collectionName === username &&
               isOpAllowed( permissions[id].operations, operation ) )
              return true;

          // collection name match
          if ( permissions[i].id === collectionName && isOpAllowed( permissions[i].operations, operation ) )
              return true;
      }

      return false;
  },

  getPermissions: function( roleName, userName, collectionName ) {
      let permissions = {};
      allowedOperations.forEach( operation => {
          permissions[operation] = this.isAllowed(roleName, userName, collectionName, operation);
      } );
      return permissions;
  },

  getDefaultRole: function () {
      return roles.default;
  }
};

function isOpAllowed( operations, requestedOp ) {
    for ( let i = 0; i < operations.length; i++ ) {
        if ( operations[i] === requestedOp ) return true;
    }
    return false;
}

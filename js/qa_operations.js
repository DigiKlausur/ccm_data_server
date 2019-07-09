/**
 * @overview Javscript module to handle questions and answers special operations
 *           for e-assessment project
 * @author Minh Nguyen <minh.nguyen@smail.inf.h-brs.de> 2019
 * @license MIT License
 */
module.exports = {
  updateAnswerDoc: _updateAnswerDoc
};

// load library modules
const mongoOps = require( './mongodb_operations' );

/**
 * Update collections containing answers for each questions
 *
 * @param {*} collection
 * @param {string} username
 * @param {Object} setData
 */
function _updateAnswerDoc( collection, username, setData ) {
  // do nothing if no answers available
  if ( !setData[ 'answers' ] ) return;

  for ( const questionId in setData[ 'answers' ] ) {
    // get name of documents containing answers for the specific question
    const ansText = setData[ 'answers' ][ questionId ][ 'text' ];
    const ansHash = setData[ 'answers' ][ questionId ][ 'hash' ];
    const ansDocName = 'answers_' + questionId;

    // skip empty answers
    if ( !ansText.trim() ) return;

    mongoOps.getDataset( collection, ansDocName ).then(
      answerData => {
        // create a document for answers if doesn't exist
        if ( answerData === null ) answerData = { 'key': ansDocName, 'entries': {} };

        // if an entry for this answer does not exist, create one
        if ( !( ansHash in answerData.entries ) ) {
          answerData.entries[ ansHash ] = { 'text': ansText, 'authors': {}, 'ranked_by': {} };
        }

        // add user to the 'authors' dict of the current answer for the current question
        answerData.entries[ ansHash ][ 'authors' ][ username ] = true;

        // remove user from 'authors' dict of other answers for the current question,
        // delete the answer if it has no author
        Object.keys( answerData.entries ).forEach( ansKey => {
          if ( ansKey === ansHash ) return;
          if ( answerData.entries[ ansKey  ][ 'authors'  ]
                && username in answerData.entries[ ansKey ][ 'authors' ] ) {
            console.log( `removing user '${ username }' ` +
                          `from the author dict of answer '${ ansKey }'` );
            delete answerData.entries[ ansKey ][ 'authors' ][ username ];
          }
          if ( !answerData.entries[ ansKey  ][ 'authors'  ]
                || Object.keys( answerData.entries[ ansKey ][ 'authors' ] ).length === 0 ) {
            console.log( `removing answer '${ ansKey }' for question '${ questionId }'` );
            delete answerData.entries[ ansKey ];
          }
        } );

        // update ranking info
        if ( 'ranking' in setData && setData[ 'ranking' ][ questionId ] ) {
          const userRankings = setData[ 'ranking' ][ questionId ];
          for ( rankedAnsHash in userRankings ) {
            if ( !( rankedAnsHash in answerData.entries ) ) continue;
            const maxRanking = Math.max( ...Object.values( userRankings ) );
            // normalize the ranking to deal with different number of ranked answers
            answerData.entries[ rankedAnsHash ][ 'ranked_by' ][ username ] =
                userRankings[ rankedAnsHash ] / maxRanking;
          }
        }

        mongoOps.setDataset( collection, answerData );
      },
      reason => console.log( `reading from '${ansDocName}' failed: ${reason}` )
    ).catch( reason => console.log( reason ) );

  }  // end for
}  // end _updateAnswerDoc()

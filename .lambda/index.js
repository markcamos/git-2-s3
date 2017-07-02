/*
* git-2-s3
*   executes on SNS event that's kicked off on a github push
*   Retrieves the latest commit, retrieves any files that were changed, deleted, added, etc. and
*   uploads them to an S3 bucket with the same name as the repo.
*   A lot of this is based on work by Matt Boggie, New York Times R&D Lab
*   Include a file called githubtoken that contains the githubtoken to include in zip up to lambda
*   Modified to extract branch from the event and use it on the S3 bucket
*     -prod for master branch updates
*     -devel for development branch updates
*/
'use strict'

var GitHub = require('github')
var async = require('async')
var AWS = require('aws-sdk')
var mime = require('mime')
var fs = require('fs')
var pathParse = require('path-parse')

var github = new GitHub()
var s3client = new AWS.S3()
const owner = 'markcamos'

exports.handler = (event, context, callback) => {
  var githubEvent = event.Records[0].Sns.Message
  var mesgattr = event.Records[0].Sns.MessageAttributes
  var tokenfile = './githubtoken'
  var fileToken = fs.readFileSync(tokenfile, 'utf8')
  var myToken = fileToken.substring(0, 40) // necessary to chop off cr or lf
  var sns = new AWS.SNS()
  var eventText = ''
  
  github.authenticate({
    type: 'oauth',
    token: myToken
  })

  console.log('Event: ', event)

  if ((mesgattr.hasOwnProperty('X-Github-Event')) && (mesgattr['X-Github-Event'].Value === 'push')) {
    var eventObj = JSON.parse(githubEvent)
    var repo = eventObj.repository.name
    var sha = eventObj.head_commit.id
    var ref = eventObj.ref
    var suffix = ''
    var parsedPath = ''

    parsedPath = pathParse(ref)
    suffix = parsedPath.name
    if (suffix === 'development') { suffix = 'devel' }
    if (suffix === 'master') { suffix = 'prod' }
    
    console.log("ref: ", ref)
    console.log("suffix: ", suffix)

    github.repos.getCommit({'owner': owner, 'repo': repo, 'sha': sha}, function (err, result) {
      if (err) {
        console.log('Error on getCommit: ', err)
      } else {
        parseCommit(result, owner, repo, suffix, function (err) {
          if (err) {
            context.fail('Parsing commit failed: ', err)
          } else {
            console.log('Transfer complete. ')

            eventText = "Finished upload of " + owner + " " + repo + " " + suffix + " " + sha
            var params = {
              Message: eventText, 
              Subject: "Transfer complete.",
              TopicArn: "arn:aws:sns:us-west-2:413067109875:git-2-s3-status"
            }
            sns.publish(params, context.done)
          };
        })
      };
    })
  };
}

function s3delete (filename, repo, cb) {
  console.log('Deleting from S3: ', filename)

  async.waterfall([
    function callDelete (callback) {
      s3client.deleteObject({'Bucket': repo, 'Key': filename}, callback)
    }
  ], function done (err) {
    if (err) {
      console.log('Delete failed: ', filename, err)
    } else {
      console.log('Delete succeeded: ', filename, repo)
    }
    cb()
  } // function
    )
}

function parseCommit (resobj, user, repo, suffix, callback) {
    // "callback" get's called after parseCommit completes
  var s3repo = ''
 
  // temporary special case for oc-static-resources... this allows us to continue to use for ocjoplinsite.com while we're testing oc-static-resources...
  if (repo === "oc-static-resources") { 
    s3repo = repo + "-" + suffix 
  } else {
    s3repo = repo
  }

  console.log("repo: ", repo, "s3repo: ", s3repo)

  if ((resobj.files) && (resobj.files.length > 0)) {
    console.log('# of files: ', resobj.files.length)
    async.each(resobj.files, function (file, eachcb) {
      if (file.status === 'removed') {
        s3delete(file.filename, s3repo, eachcb)
      } else {
        if (file.status === 'renamed') {
          async.waterfall([
            function calldeleter (wfcb) {
              s3delete(file.previous_filename, s3repo, wfcb)
            },
            function callputter (wfcb) {
              s3put(file, user, repo, s3repo, wfcb)
            }], function done (err) {
            eachcb(err)
          })
        } else {
          s3put(file, user, repo, s3repo, eachcb)
        }
      }
    }, function (err) {
      console.log('Any errors? ', err)
      callback(err) //
    })
  } else {
    console.log(resobj.html_url, 'No files changed... Exiting.')
    callback(new Error('No files changed'))
  }
}

function s3put (file, user, repo, s3repo, cb) {
  var blob = ''
  var isText = ''
  var mimetype = ''
  async.waterfall([
    function download (callback) {
            // call github and grab blob
      console.log('Download from github: ' + file.filename)
      github.gitdata.getBlob({'owner': user, 'repo': repo, 'sha': file.sha}, callback)
    },
    function store (result, callback) {
            // get contents from returned object
      blob = new Buffer(result.content, 'base64')
      mimetype = mime.lookup(file.filename)
      isText = (mime.charsets.lookup(mimetype) === 'UTF-8')
      if (isText) {
        blob = blob.toString('utf-8')
      }
      console.log('Upload to S3: ', file.filename, 'bucket: ', s3repo, 'type: ', mimetype)

      s3client.putObject({'Bucket': s3repo, 'Key': file.filename, 'Body': blob, 'ContentType': mimetype}, callback)
    }
  ], function done (err) {
    if (err) {
      console.log('Upload failed: ', file.filename, 'bucket: ', s3repo, 'err: ', err)
    } else {
      console.log('Upload succeeded: ', file.filename, 'bucket: ', s3repo)
    }
    cb() // don't pass error until completed.
  }
  )
}

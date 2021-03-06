# git-2-s3
lambda function to move code from git to s3 on commit

After cloning this repo:
cd git-2-s3
npm install

Add a valid github token in the one-line file "githubtoken"  (this avoids putting it in the repo...)

This app uses an IAM role called git-2-s3 (original, huh?) that has:
AmazonS3FullAccess
AmazonSNSReadOnlyAccess
AWSLambdaBasicExecutionRole 
and a custom policy that allows it to log to CloudWatch:
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "logs:*"
            ],
            "Resource": [
                "arn:aws:logs:::*"
            ]
        }
    ]
}

The S3 buckets for apps to be deployed using this tool need something like:
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AddPerm",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::oc-static-test.oc-proxy.com/*"
    }
  ]
}

Once everything is set up:
npm run deploy 

This should build and upload the lambda app to AWS. You should rarely have to do this. The last time I did was to increase memory for the lambda app. I could have done this from the AWS console...

The git-2-s3 lambda function is based on https://github.com/nytlabs/github-s3-deploy/blob/master/index.js

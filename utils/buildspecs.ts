import codebuild = require('@aws-cdk/aws-codebuild');
import * as iam from '@aws-cdk/aws-iam';
import * as cdk from '@aws-cdk/core';
import * as eks from '@aws-cdk/aws-eks';
import { PipelineProject } from '@aws-cdk/aws-codebuild';
import * as ecr from '@aws-cdk/aws-ecr';

export function codeToECRspec (scope: cdk.Construct, apprepo: string) :PipelineProject {
    const buildForECR = new codebuild.PipelineProject(scope, `build-to-ecr`, { 
        projectName: `build-to-ecr`,
        environment: {
            buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_DOCKER_18_09_0,
            privileged: true
        },
        environmentVariables: { 'ECR_REPO_URI': {
            value: apprepo
          } },
        buildSpec: codebuild.BuildSpec.fromObject({
            version: "0.2",
            phases: {
                pre_build: {
                    commands: [
                        'env', `$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)`, 
                        // `COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)`,
                        'IMAGE_TAG=$CODEBUILD_RESOLVED_SOURCE_VERSION'
                    ]
                },
                build: {
                    commands: [
                        'docker build -t $ECR_REPO_URI:latest .',
                        'docker tag $ECR_REPO_URI:latest $ECR_REPO_URI:$IMAGE_TAG'
                    ]
                },
                post_build: {
                    commands: [
                        'docker push $ECR_REPO_URI:latest',
                        'docker push $ECR_REPO_URI:$IMAGE_TAG'
                    ]
                }
            }
        })
     });

     return buildForECR;

}


export function deployToEKSspec (scope: cdk.Construct, region: string, cluster: eks.Cluster, apprepo: ecr.IRepository) :PipelineProject {
    
    const deployBuildSpec = new codebuild.PipelineProject(scope, `deploy-to-eks-${region}`, {
        environment: {
            buildImage: codebuild.LinuxBuildImage.fromAsset(scope, `custom-image-for-eks-${region}`, {
                directory: './utils/buildimage'
            }),
            privileged: true
        },
        environmentVariables: { 
            'REGION': { value:  region },
            'CLUSTER_NAME': {  value: `demogo` },
            'ECR_REPO_URI': {  value: apprepo.repositoryUri } ,
        },
        buildSpec: codebuild.BuildSpec.fromObject({
            version: "0.2",
            phases: {
              install: {
                commands: [
                  'env',
                  'export TAG=${CODEBUILD_RESOLVED_SOURCE_VERSION}',
                  'aws sts get-caller-identity',
                  '/usr/local/bin/entrypoint.sh'                    ]
              },
              build: {
                commands: [
                    `sed -i 's@CONTAINER_IMAGE@'"$ECR_REPO_URI:$TAG"'@' hello-py.yaml`,
                    'kubectl apply -f hello-py.yaml'
                ]
              }
            }})
    });

    cluster.awsAuth.addMastersRole(deployBuildSpec.role!);
    deployBuildSpec.addToRolePolicy(new iam.PolicyStatement({
      actions: ['eks:DescribeCluster'],
      resources: [`*`],
    }));

    return deployBuildSpec;

}

export function replicateECRspec (scope: cdk.Construct, originRepo: ecr.IRepository, targetRepo: ecr.IRepository):PipelineProject {
    const replicateBuildspec = new codebuild.PipelineProject(scope, `replicate-to-2nd-region-ecr`, {
        environment: {
            buildImage: codebuild.LinuxBuildImage.UBUNTU_14_04_DOCKER_18_09_0,
            privileged: true
        },
        buildSpec: codebuild.BuildSpec.fromObject({
            version: "0.2",
            phases: {
                build: {
                    commands: [
                        `$(aws ecr get-login --region $AWS_DEFAULT_REGION --no-include-email)`,
                        "IMAGE_TAG=$CODEBUILD_RESOLVED_SOURCE_VERSION",
                        `srcImage=${originRepo.repositoryUri}/$IMAGE_TAG`,
                        `docker pull $srcImage`,
                        `targetImage=${targetRepo.repositoryUri}/$IMAGE_TAG`,
                        `docker tag $srcImage $targetImage`,
                        `docker push $targetImage`
                    ]
                }
            }  
        })
    });

    return replicateBuildspec;
}


"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _service_1 = __importDefault(require("./_service"));
const AppConfigService_1 = __importDefault(require("./AppConfigService"));
const ConsoleService_1 = __importDefault(require("./ConsoleService"));
const AWSService_1 = __importDefault(require("./AWSService"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const rws_js_server_1 = require("rws-js-server");
const { log, warn, error, color, AWSProgressBar } = ConsoleService_1.default;
class LambdaService extends _service_1.default {
    constructor() {
        super();
        this.efs = aws_sdk_1.default.EFS;
    }
    async archiveLambda(lambdaDirPath, moduleCfgDir) {
        log(color().green('[RWS Lambda Service]') + ' initiating archiving of: ', lambdaDirPath);
        const lambdaDirName = lambdaDirPath.split('/').filter(Boolean).pop();
        const [zipPathWithoutNodeModules, zipPathWithNodeModules] = this.determineLambdaPackagePaths(lambdaDirName, moduleCfgDir);
        // Create lambda directory if it doesn't exist
        if (!fs_1.default.existsSync(path_1.default.join(moduleCfgDir, 'lambda'))) {
            fs_1.default.mkdirSync(path_1.default.join(moduleCfgDir, 'lambda'));
        }
        // Create archives
        const tasks = [];
        if (!fs_1.default.existsSync(zipPathWithNodeModules)) {
            log(`${color().green('[RWS Lambda Service]')} archiving .node_modules from ROOT_DIR to .zip`);
            tasks.push(AWSService_1.default.createArchive(zipPathWithNodeModules, lambdaDirPath, true));
        }
        if (fs_1.default.existsSync(zipPathWithoutNodeModules)) {
            fs_1.default.unlinkSync(zipPathWithoutNodeModules);
        }
        log(`${color().green('[RWS Lambda Service]')} archiving ${lambdaDirPath} to .zip`);
        tasks.push(AWSService_1.default.createArchive(zipPathWithoutNodeModules, lambdaDirPath));
        await Promise.all(tasks);
        log(`${color().green('[RWS Lambda Service]')} ${color().yellowBright('ZIP package complete.')}`);
        return [zipPathWithNodeModules, zipPathWithoutNodeModules];
    }
    determineLambdaPackagePaths(lambdaDirName, moduleCfgDir) {
        const zipPathWithNodeModules = path_1.default.join(moduleCfgDir, 'lambda', `RWS-modules.zip`);
        const zipPathWithoutNodeModules = path_1.default.join(moduleCfgDir, 'lambda', `lambda-${lambdaDirName}-app.zip`);
        return [zipPathWithoutNodeModules, zipPathWithNodeModules];
    }
    async deployLambda(functionName, appPaths, subnetId) {
        const [zipPath, layerPath] = appPaths;
        console.log(appPaths);
        this.region = (0, AppConfigService_1.default)().get('aws_lambda_region');
        const zipFile = fs_1.default.readFileSync(zipPath);
        try {
            const s3BucketName = (0, AppConfigService_1.default)().get('aws_lambda_bucket');
            await AWSService_1.default.S3BucketExists(s3BucketName);
            // const layerARN = await this.createLambdaLayer(layerPath, functionName);
            const [efsId, efsExisted] = await AWSService_1.default.createEFS('RWS_EFS', subnetId);
            if (!efsExisted) {
                log(`${color().green('[RWS Lambda Service]')} creating EFS for lambda.`);
                await this.deployModules(layerPath, functionName, efsId, subnetId);
            }
            else {
                log(`${color().green('[RWS Lambda Service]')} EFS for lambda is created.`);
                await this.deployModules(layerPath, functionName, efsId, subnetId);
            }
            log(`${color().green('[RWS Lambda Service]')} ${color().yellowBright('deploying lambda on ' + this.region + ' using ' + s3BucketName)}`);
            const s3params = {
                Bucket: s3BucketName,
                Key: functionName + '.zip',
                Body: zipFile
            };
            try {
                const uplPromise = AWSService_1.default.getS3().upload(s3params);
                // AWSProgressBar(uplPromise);
                const s3Data = await uplPromise.promise();
                log(`${color().green('[RWS Lambda Service]')} uploading ${zipPath} to S3Bucket`);
                const s3Path = s3Data.Key;
                const Code = {
                    S3Bucket: s3BucketName,
                    S3Key: s3Path
                };
                let data = null;
                if (await this.functionExists(functionName)) {
                    data = await AWSService_1.default.getLambda().updateFunctionCode({
                        FunctionName: functionName,
                        ...Code
                    }).promise();
                }
                else {
                    const createParams = {
                        FunctionName: functionName,
                        Runtime: 'nodejs18.x',
                        Role: (0, AppConfigService_1.default)().get('aws_lambda_role'),
                        Handler: 'index.js',
                        Code,
                        VpcConfig: {
                            SubnetIds: [subnetId],
                            SecurityGroupIds: await AWSService_1.default.listSecurityGroups(), // Add your security group ID
                        }
                    };
                    data = await AWSService_1.default.getLambda().createFunction(createParams).promise();
                }
                await this.waitForLambda(functionName);
                // log(`${color().green('[RWS Lambda Service]')} ${color().yellowBright(`${zipPath} has been deleted after successful deployment`)}`);
                log(`${color().green(`[RWS Lambda Service] lambda function "${functionName}" deployed`)}`);
            }
            catch (e) {
                throw e;
            }
        }
        catch (err) {
            error(err.message);
            log(err.stack);
        }
    }
    async deployModules(layerPath, functionName, efsId, subnetId) {
        const _RWS_MODULES_UPLOADED = '_rws_efs_modules_uploaded';
        const savedKey = rws_js_server_1.ProcessService.getRWSVar(_RWS_MODULES_UPLOADED);
        const S3Bucket = (0, rws_js_server_1.getAppConfig)().get('aws_lambda_bucket');
        if (savedKey) {
            await AWSService_1.default.uploadToEFS(efsId, savedKey, S3Bucket, subnetId);
            return;
        }
        log(`${color().green('[RWS Lambda Service]')} ${color().yellowBright('deploying lambda modules on ' + this.region + ' using ' + functionName)}`);
        if (!savedKey) {
            const zipFile = fs_1.default.readFileSync(layerPath);
            const s3params = {
                Bucket: S3Bucket,
                Key: 'RWS-modules.zip',
                Body: zipFile
            };
            const uplPromise = AWSService_1.default.getS3().upload(s3params);
            log(`${color().green('[RWS Lambda Service]')} layer uploading ${layerPath} to S3Bucket`);
            const s3Data = await uplPromise.promise();
            const s3Path = s3Data.Key;
            log(`${color().green('[RWS Lambda Service]')} ${color().yellowBright('lambda layer is uploaded to ' + this.region + ' with key:  ' + s3Path)}`);
            rws_js_server_1.ProcessService.setRWSVar(_RWS_MODULES_UPLOADED, s3Path);
            await AWSService_1.default.uploadToEFS(efsId, s3Path, S3Bucket, subnetId);
        }
    }
    async functionExists(functionName) {
        try {
            await AWSService_1.default.getLambda().getFunction({ FunctionName: functionName }).promise();
        }
        catch (e) {
            if (e.code === 'ResourceNotFoundException') {
                return false;
            }
        }
        return true;
    }
    async waitForLambda(functionName, timeoutMs = 300000, intervalMs = 5000) {
        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
            const { Configuration } = await AWSService_1.default.getLambda().getFunction({ FunctionName: functionName }).promise();
            if (Configuration.State === 'Active') {
                return; // Lambda is active and ready
            }
            // If the state is 'Failed', you can either throw an error or handle it differently based on your use case
            if (Configuration.State === 'Failed') {
                throw new Error(`Lambda function ${functionName} failed to be ready. Reason: ${Configuration.StateReason}`);
            }
            // Wait for the specified interval
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
        throw new Error(`Lambda function ${functionName} did not become ready within ${timeoutMs}ms.`);
    }
}
exports.default = LambdaService.getSingleton();
//# sourceMappingURL=LambdaService.js.map
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _service_1 = __importDefault(require("./_service"));
const AppConfigService_1 = __importDefault(require("./AppConfigService"));
const ConsoleService_1 = __importDefault(require("./ConsoleService"));
const AWSService_1 = __importDefault(require("./AWSService"));
const ZipService_1 = __importDefault(require("./ZipService"));
const S3Service_1 = __importDefault(require("./S3Service"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const rws_js_server_1 = require("rws-js-server");
const FSService_1 = __importDefault(require("./FSService"));
const { log, warn, error, color, AWSProgressBar } = ConsoleService_1.default;
class LambdaService extends _service_1.default {
    constructor() {
        super();
    }
    async archiveLambda(lambdaDirPath, moduleCfgDir) {
        const lambdaDirName = lambdaDirPath.split('/').filter(Boolean).pop();
        const [lambdaPath, modulesPath] = this.determineLambdaPackagePaths(lambdaDirName, moduleCfgDir);
        if (!fs_1.default.existsSync(path_1.default.join(moduleCfgDir, 'lambda'))) {
            fs_1.default.mkdirSync(path_1.default.join(moduleCfgDir, 'lambda'));
        }
        // Create archives
        const tasks = [];
        if (!fs_1.default.existsSync(modulesPath)) {
            log(`${color().green('[RWS Lambda Service]')} archiving .node_modules from ROOT_DIR to .zip`);
            tasks.push(ZipService_1.default.createArchive(modulesPath, `${process.cwd()}/node_modules`, { ignore: ['.rws/**', '.prisma/**'] }));
        }
        if (fs_1.default.existsSync(lambdaPath)) {
            fs_1.default.unlinkSync(lambdaPath);
        }
        log(`${color().green('[RWS Lambda Service]')} archiving ${color().yellowBright(lambdaDirPath)} to:\n ${color().yellowBright(lambdaPath)}`);
        tasks.push(ZipService_1.default.createArchive(lambdaPath, lambdaDirPath));
        await Promise.all(tasks);
        log(`${color().green('[RWS Lambda Service]')} ${color().yellowBright('ZIP package complete.')}`);
        return [lambdaPath, modulesPath];
    }
    determineLambdaPackagePaths(lambdaDirName, moduleCfgDir) {
        const modulesPath = path_1.default.join(moduleCfgDir, 'lambda', `RWS-modules.zip`);
        const lambdaPath = path_1.default.join(moduleCfgDir, 'lambda', `lambda-${lambdaDirName}-app.zip`);
        return [lambdaPath, modulesPath];
    }
    async deployLambda(functionName, appPaths, subnetId, noEFS = false) {
        const [zipPath, layerPath] = appPaths;
        this.region = (0, AppConfigService_1.default)().get('aws_lambda_region');
        const zipFile = fs_1.default.readFileSync(zipPath);
        try {
            const s3BucketName = (0, AppConfigService_1.default)().get('aws_lambda_bucket');
            await S3Service_1.default.bucketExists(s3BucketName);
            const [efsId, accessPointArn, efsExisted] = await FSService_1.default.getOrCreateEFS('RWS_EFS', subnetId);
            if (!noEFS) {
                if (!efsExisted) {
                    await this.deployModules(layerPath, functionName, efsId, subnetId);
                }
                else {
                    await this.deployModules(layerPath, functionName, efsId, subnetId); //@TODO: make it on-demand
                }
            }
            log(`${color().green('[RWS Lambda Service]')} ${color().yellowBright('deploying lambda on ' + this.region + ' using ' + s3BucketName)}`);
            const s3params = {
                Bucket: s3BucketName,
                Key: functionName + '.zip',
                Body: zipFile
            };
            const s3Data = await S3Service_1.default.upload(s3params);
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
                    },
                    FileSystemConfigs: [
                        {
                            Arn: accessPointArn,
                            LocalMountPath: '/mnt/efs' // The path in your Lambda function environment where the EFS will be mounted
                        }
                    ]
                };
                log(color().green('[RWS Lambda Service] is creating Lambda function named: ') + color().yellowBright(functionName));
                data = await AWSService_1.default.getLambda().createFunction(createParams).promise();
            }
            await this.waitForLambda(functionName);
            log(`${color().green(`[RWS Lambda Service] lambda function "${functionName}" deployed`)}`);
        }
        catch (err) {
            error(err.message);
            log(err.stack);
            throw err;
        }
    }
    async deployModules(layerPath, functionName, efsId, subnetId) {
        const _RWS_MODULES_UPLOADED = '_rws_efs_modules_uploaded';
        const savedKey = rws_js_server_1.ProcessService.getRWSVar(_RWS_MODULES_UPLOADED);
        const S3Bucket = (0, rws_js_server_1.getAppConfig)().get('aws_lambda_bucket');
        if (savedKey) {
            log(`${color().green('[RWS Lambda Service]')} key saved. Deploying by cache.`);
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
            log(`${color().green('[RWS Lambda Service]')} layer uploading ${layerPath} to S3Bucket`);
            const s3Data = await S3Service_1.default.upload(s3params);
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
                log(e.message);
                return false;
            }
        }
        return true;
    }
    async waitForLambda(functionName, timeoutMs = 300000, intervalMs = 5000) {
        const startTime = Date.now();
        log(`${color().yellowBright('[Lambda Listener] awaiting Lembda state change')}`);
        while (Date.now() - startTime < timeoutMs) {
            log(`${color().yellowBright('[Lambda Listener] .')}`);
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
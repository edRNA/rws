"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _command_1 = __importDefault(require("./_command"));
const ConsoleService_1 = __importDefault(require("../services/ConsoleService"));
const AWSService_1 = __importDefault(require("../services/AWSService"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const UtilsService_1 = __importDefault(require("../services/UtilsService"));
const EFSService_1 = __importDefault(require("../services/EFSService"));
const LambdaService_1 = __importDefault(require("../services/LambdaService"));
const { log, warn, error, color } = ConsoleService_1.default;
const executionDir = process.cwd();
const moduleCfgDir = `${executionDir}/node_modules/.rws`;
const cfgPathFile = `${moduleCfgDir}/_cfg_path`;
const moduleDir = path_1.default.resolve(path_1.default.dirname(module.id), '..', '..').replace('dist', '');
const lambdasCfg = {
    artillery: {
        preArchive: async (params) => {
            const sourceArtilleryCfg = `${path_1.default.resolve(process.cwd())}/artillery-config.yml`;
            const targetArtilleryCfg = `${moduleDir}/lambda-functions/artillery/artillery-config.yml`;
            if (fs_1.default.existsSync(targetArtilleryCfg)) {
                fs_1.default.unlinkSync(targetArtilleryCfg);
            }
            if (!fs_1.default.existsSync(sourceArtilleryCfg)) {
                throw `Create "artillery-config.yml" in your project root directory.`;
            }
            log(color().green('[RWS Lambda CLI]') + ' copying artillery config.');
            fs_1.default.copyFileSync(sourceArtilleryCfg, targetArtilleryCfg);
        }
    }
};
class LambdaCommand extends _command_1.default {
    constructor() {
        super('lambda', module);
        this.executeLambdaLifeCycle = async (lifeCycleEventName, lambdaDirName, params) => {
            if (!lambdasCfg[lambdaDirName] || !lambdasCfg[lambdaDirName][lifeCycleEventName]) {
                return;
            }
            const theAction = lambdasCfg[lambdaDirName][lifeCycleEventName];
            if (theAction && UtilsService_1.default.isInterface(theAction)) {
                log('executing action');
                await theAction(params);
            }
        };
    }
    async execute(params) {
        const { lambdaCmd } = await this.getLambdaParameters(params);
        switch (lambdaCmd) {
            case 'deploy':
                await this.deploy(params);
                return;
            case 'delete':
                await this.delete(params);
                return;
            default:
                error(`[RWS Lambda CLI] "${lambdaCmd}" command is not supported in RWS Lambda CLI`);
                log(`Try: "deploy:${lambdaCmd}", "kill:${lambdaCmd}" or "list:${lambdaCmd}"`);
                return;
        }
    }
    async getLambdaParameters(params) {
        const lambdaString = params.lambdaString || params._default;
        const vpcId = params.subnetId || await AWSService_1.default.findDefaultVPC();
        const lambdaStringArr = lambdaString.split(':');
        const lambdaCmd = lambdaStringArr[0];
        const lambdaDirName = lambdaStringArr[1];
        const lambdaArg = lambdaStringArr.length > 2 ? lambdaStringArr[2] : null;
        return {
            lambdaCmd,
            lambdaDirName,
            vpcId,
            lambdaArg
        };
    }
    async deploy(params) {
        const { lambdaDirName, vpcId } = await this.getLambdaParameters(params);
        if (lambdaDirName === 'modules') {
            const modulesPath = path_1.default.join(moduleCfgDir, 'lambda', `RWS-modules.zip`);
            const [efsId] = await EFSService_1.default.getOrCreateEFS('RWS_EFS', vpcId);
            await LambdaService_1.default.deployModules(modulesPath, efsId, vpcId, true);
            return;
        }
        const lambdaParams = {
            rwsConfig: params._rws_config,
            subnetId: vpcId
        };
        log(color().green('[RWS Lambda CLI]') + ' preparing artillery lambda function...');
        await this.executeLambdaLifeCycle('preArchive', lambdaDirName, lambdaParams);
        const lambdaPaths = await LambdaService_1.default.archiveLambda(`${moduleDir}/lambda-functions/${lambdaDirName}`, moduleCfgDir);
        await this.executeLambdaLifeCycle('postArchive', lambdaDirName, lambdaParams);
        await this.executeLambdaLifeCycle('preDeploy', lambdaDirName, lambdaParams);
        try {
            await LambdaService_1.default.deployLambda('RWS-' + lambdaDirName, lambdaPaths, vpcId);
            await this.executeLambdaLifeCycle('postDeploy', lambdaDirName, lambdaParams);
        }
        catch (e) {
            error(e.message);
            log(e.stack);
        }
        log(color().green(`[RWS Lambda CLI] ${lambdaDirName} lambda function is deployed`));
    }
    async delete(params) {
        const { lambdaDirName } = await this.getLambdaParameters(params);
        await LambdaService_1.default.deleteLambda('RWS-' + lambdaDirName);
        log(color().green(`[RWS Lambda CLI] ${lambdaDirName} lambda function has been ${color().red('deleted')}.`));
    }
}
exports.default = new LambdaCommand();
//# sourceMappingURL=LambdaCommand.js.map
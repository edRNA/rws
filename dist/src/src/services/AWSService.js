"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const _service_1 = __importDefault(require("./_service"));
const AppConfigService_1 = __importDefault(require("./AppConfigService"));
const ConsoleService_1 = __importDefault(require("./ConsoleService"));
const LambdaService_1 = __importDefault(require("./LambdaService"));
const path_1 = __importDefault(require("path"));
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const { log, warn, error, color, AWSProgressBar, rwsLog } = ConsoleService_1.default;
class AWSService extends _service_1.default {
    constructor() {
        super();
    }
    _initApis() {
        if (!this.region) {
            this.region = (0, AppConfigService_1.default)().get('aws_lambda_region');
        }
        if (!this.s3) {
            this.s3 = new aws_sdk_1.default.S3({
                region: this.region,
                credentials: {
                    accessKeyId: (0, AppConfigService_1.default)().get('aws_access_key'),
                    secretAccessKey: (0, AppConfigService_1.default)().get('aws_secret_key'),
                }
            });
        }
        if (!this.iam) {
            this.iam = new aws_sdk_1.default.IAM({
                region: this.region,
                credentials: {
                    accessKeyId: (0, AppConfigService_1.default)().get('aws_access_key'),
                    secretAccessKey: (0, AppConfigService_1.default)().get('aws_secret_key'),
                }
            });
        }
        if (!this.efs) {
            this.efs = new aws_sdk_1.default.EFS({
                region: this.region,
                credentials: {
                    accessKeyId: (0, AppConfigService_1.default)().get('aws_access_key'),
                    secretAccessKey: (0, AppConfigService_1.default)().get('aws_secret_key'),
                }
            });
        }
        if (!this.ec2) {
            this.ec2 = new aws_sdk_1.default.EC2({
                region: this.region,
                credentials: {
                    accessKeyId: (0, AppConfigService_1.default)().get('aws_access_key'),
                    secretAccessKey: (0, AppConfigService_1.default)().get('aws_secret_key'),
                }
            });
        }
        if (!this.lambda) {
            this.lambda = new aws_sdk_1.default.Lambda({
                region: this.region,
                credentials: {
                    accessKeyId: (0, AppConfigService_1.default)().get('aws_access_key'),
                    secretAccessKey: (0, AppConfigService_1.default)().get('aws_secret_key'),
                }
            });
        }
    }
    async findDefaultSubnetForVPC() {
        try {
            const response = await this.getEC2().describeVpcs({ Filters: [{ Name: 'isDefault', Values: ['true'] }] }).promise();
            if (response.Vpcs && response.Vpcs.length > 0) {
                return [await this.getSubnetIdForVpc(response.Vpcs[0].VpcId), response.Vpcs[0].VpcId];
            }
            else {
                console.log('No default VPC found.');
            }
        }
        catch (error) {
            console.error('Error fetching default VPC:', error);
        }
    }
    async getSubnetIdForVpc(vpcId) {
        const params = {
            Filters: [{
                    Name: 'vpc-id',
                    Values: [vpcId]
                }]
        };
        const result = await this.getEC2().describeSubnets(params).promise();
        if (result.Subnets && result.Subnets.length > 0) {
            return result.Subnets.map(subnet => subnet.SubnetId)[0];
        }
        else {
            return null;
        }
    }
    async listSecurityGroups() {
        try {
            const result = await this.getEC2().describeSecurityGroups().promise();
            const securityGroups = result.SecurityGroups || [];
            const securityGroupIds = securityGroups.map(sg => sg.GroupId);
            return securityGroupIds;
        }
        catch (error) {
            console.error('Error fetching security groups:', error);
            return [];
        }
    }
    async uploadToEFS(baseFunctionName, efsId, modulesS3Key, s3Bucket, vpcId, subnetId) {
        const efsLoaderFunctionName = await this.processEFSLoader(vpcId, subnetId);
        const params = {
            functionName: `RWS-${baseFunctionName}`,
            efsId,
            modulesS3Key,
            s3Bucket
        };
        try {
            log(`${color().green(`[RWS Lambda Service]`)} invoking EFS Loader as "${efsLoaderFunctionName}" lambda function for "${baseFunctionName}" with ${modulesS3Key} in ${s3Bucket} bucket.`);
            const response = await LambdaService_1.default.invokeLambda(efsLoaderFunctionName, params);
            rwsLog('RWS Lambda Service', color().yellowBright(`"${efsLoaderFunctionName}" lambda function response:`));
            log(response);
            return; // JSON.parse(response.Response.Payload as string);
        }
        catch (error) {
            // await EFSService.deleteEFS(efsId);
            console.error('Error invoking Lambda:', error);
            throw error;
        }
    }
    async processEFSLoader(vpcId, subnetId) {
        const executionDir = process.cwd();
        const filePath = module.id;
        const cmdDir = filePath.replace('./', '').replace(/\/[^/]*\.ts$/, '');
        const moduleDir = path_1.default.resolve(__dirname, '..', '..').replace('dist', '');
        const moduleCfgDir = `${executionDir}/node_modules/.rws`;
        const _UNZIP_FUNCTION_NAME = 'RWS-efs-loader';
        log(`${color().green(`[RWS Clud FS Service]`)} processing EFS Loader as "${_UNZIP_FUNCTION_NAME}" lambda function.`);
        if (!(await LambdaService_1.default.functionExists(_UNZIP_FUNCTION_NAME))) {
            log(`${color().green(`[RWS Clud FS Service]`)} creating EFS Loader as "${_UNZIP_FUNCTION_NAME}" lambda function.`, moduleDir);
            const zipPath = await LambdaService_1.default.archiveLambda(`${moduleDir}/lambda-functions/efs-loader`, moduleCfgDir);
            await LambdaService_1.default.deployLambda(_UNZIP_FUNCTION_NAME, zipPath, vpcId, subnetId, true);
        }
        return _UNZIP_FUNCTION_NAME;
    }
    async checkForRolePermissions(roleARN, permissions) {
        const { OK, policies } = await this.firePermissionCheck(roleARN, permissions);
        return {
            OK,
            policies
        };
    }
    async firePermissionCheck(roleARN, permissions) {
        const params = {
            PolicySourceArn: roleARN,
            ActionNames: permissions
        };
        const policies = [];
        let allowed = true;
        try {
            const data = await this.getIAM().simulatePrincipalPolicy(params).promise();
            for (let result of data.EvaluationResults) {
                if (result.EvalDecision !== 'allowed') {
                    allowed = false;
                    policies.push(result.EvalActionName);
                }
            }
        }
        catch (err) {
            error('Permission check error:');
            log(err);
            allowed = false;
        }
        return {
            OK: allowed,
            policies: policies
        };
    }
    async getDefaultRouteTable(vpcId) {
        var _a;
        const routeTablesResponse = await this.ec2.describeRouteTables({
            Filters: [
                {
                    Name: "vpc-id",
                    Values: [vpcId] // Provide the VPC ID here, not the VPC Endpoint ID
                }
            ]
        }).promise();
        return (_a = routeTablesResponse.RouteTables) === null || _a === void 0 ? void 0 : _a.find(rt => {
            // A default route table won't have explicit subnet associations
            return !rt.Associations || rt.Associations.every(assoc => !assoc.SubnetId);
        });
    }
    async createVPCEndpointIfNotExist(vpcId) {
        const endpointName = "RWS-S3-GATE";
        const serviceName = `com.amazonaws.${this.region}.s3`;
        // Describe VPC Endpoints
        const existingEndpoints = await this.getEC2().describeVpcEndpoints({
            Filters: [
                {
                    Name: "tag:Name",
                    Values: [endpointName]
                }
            ]
        }).promise();
        const defaultRouteTable = await this.getDefaultRouteTable(vpcId);
        // Check if the endpoint already exists
        const endpointExists = existingEndpoints.VpcEndpoints && existingEndpoints.VpcEndpoints.length > 0;
        if (!endpointExists) {
            // Create VPC Endpoint for S3
            const endpointResponse = await this.getEC2().createVpcEndpoint({
                VpcId: vpcId,
                ServiceName: serviceName,
                VpcEndpointType: "Gateway",
                RouteTableIds: [defaultRouteTable.RouteTableId],
                TagSpecifications: [
                    {
                        ResourceType: "vpc-endpoint",
                        Tags: [
                            {
                                Key: "Name",
                                Value: endpointName
                            }
                        ]
                    }
                ]
            }).promise();
            if (endpointResponse.VpcEndpoint) {
                log(`VPC Endpoint "${endpointName}" created with ID: ${endpointResponse.VpcEndpoint.VpcEndpointId}`);
                return endpointResponse.VpcEndpoint.VpcEndpointId;
            }
            else {
                error("Failed to create VPC Endpoint");
                throw new Error("Failed to create VPC Endpoint");
            }
        }
        else {
            log(`VPC Endpoint "${endpointName}" already exists.`);
            return existingEndpoints.VpcEndpoints[0].VpcEndpointId;
        }
    }
    async ensureRouteToVPCEndpoint(vpcId, vpcEndpointId) {
        try {
            const routeTable = await this.getDefaultRouteTable(vpcId);
            const routes = routeTable.Routes || [];
            const hasS3EndpointRoute = routes.some((route) => route.GatewayId === vpcEndpointId);
            if (!hasS3EndpointRoute) {
                // Get the prefix list associated with the S3 VPC endpoint
                const vpcEndpointDescription = (await this.ec2.describeVpcEndpoints({
                    VpcEndpointIds: [vpcEndpointId]
                }).promise()).VpcEndpoints;
                rwsLog('Creating VPC Endpoint route');
                // Add a route to the route table
                await this.ec2.createRoute({
                    RouteTableId: routeTable.RouteTableId,
                    DestinationCidrBlock: '0.0.0.0/0',
                    VpcEndpointId: vpcEndpointDescription[0].VpcEndpointId
                }).promise();
                log(`Added route to VPC Endpoint ${vpcEndpointId} in Route Table ${routeTable.RouteTableId}`);
            }
            else {
                log(`Route to VPC Endpoint ${vpcEndpointId} already exists in Route Table ${routeTable.RouteTableId}`);
            }
        }
        catch (error) {
            console.error('Error ensuring route to VPC Endpoint:', error);
        }
    }
    getS3() {
        this._initApis();
        return this.s3;
    }
    getEC2() {
        this._initApis();
        return this.ec2;
    }
    getEFS() {
        this._initApis();
        return this.efs;
    }
    getLambda() {
        this._initApis();
        return this.lambda;
    }
    getRegion() {
        this._initApis();
        return this.region;
    }
    getIAM() {
        this._initApis();
        return this.iam;
    }
}
exports.default = AWSService.getSingleton();
//# sourceMappingURL=AWSService.js.map
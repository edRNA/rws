import Command, { ICmdParams } from "./_command";
interface ILambdaParams {
    rwsConfig?: any;
    subnetId?: string;
}
type ILifeCycleMethod = (params: ILambdaParams) => Promise<void> | null;
type ILambdaLifeCycleEvents = {
    preArchive?: ILifeCycleMethod;
    postArchive?: ILifeCycleMethod;
    preDeploy?: ILifeCycleMethod;
    postDeploy?: ILifeCycleMethod;
};
interface ILambdasLifeCycleConfig {
    [key: string]: ILambdaLifeCycleEvents;
}
type ILambdaSubCommand = 'deploy' | 'delete' | string;
interface ILambdaParamsReturn {
    lambdaCmd: ILambdaSubCommand;
    lambdaDirName: string;
    vpcId: string;
    lambdaArg: string;
}
declare class LambdaCommand extends Command {
    constructor();
    execute(params?: ICmdParams): Promise<void>;
    executeLambdaLifeCycle: (lifeCycleEventName: keyof ILambdaLifeCycleEvents, lambdaDirName: keyof ILambdasLifeCycleConfig, params: ILambdaParams) => Promise<void>;
    getLambdaParameters(params: ICmdParams): Promise<ILambdaParamsReturn>;
    deploy(params: ICmdParams): Promise<void>;
    delete(params: ICmdParams): Promise<void>;
}
declare const _default_1: LambdaCommand;
export default _default_1;
export { ILambdaParams, ILambdaParamsReturn };

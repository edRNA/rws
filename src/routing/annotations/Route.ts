import 'reflect-metadata';

type RequestMethodType = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface IHTTProuteParams {
    responseFormat: string
}

interface IHTTProuteOpts {
    name: string;
    method: RequestMethodType;
    params?: IHTTProuteParams
}


  
function Route(name: string, method: RequestMethodType = 'GET', params: IHTTProuteParams = { responseFormat: 'json' }) {
    let metaOpts: IHTTProuteOpts = {name, method, params};

    return function(target: any, key: string) {          
        Reflect.defineMetadata(`Route:${key}`, metaOpts, target);
    };
}

export default Route;
export {IHTTProuteOpts, RequestMethodType}